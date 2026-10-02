import pool, { query } from '../config/database';
import {
  AUTO_REMIND_AFTER_DAYS,
  AUTO_REMIND_EVERY_DAYS,
  AUTO_REMIND_MAX,
  MentorFollowupModel,
} from '../models/mentorFollowup';
import { AuditAction, writeAudit } from './audit';
import { SilentMentorDigestRow, sendMentorReminderEmail, sendMentorSilentDigestEmail } from './email';
import {
  MENTOR_LINK_TTL_SYSTEM_MS,
  isPureMentor,
  issueMentorLoginLink,
  revokeMentorLoginLink,
} from './mentorLoginLink';

/**
 * เฟส 3 "เตือนอัตโนมัติ" — ระบบเตือนพี่เลี้ยงเองด้วยอีเมลสรุปฉบับเดียวกับที่เจ้าหน้าที่กดเตือน (เฟส 2)
 * และส่งพี่เลี้ยงที่เงียบหลังเตือนครบเพดานขึ้นไปให้เจ้าหน้าที่ตามเอง
 *
 * ⛔ **ปิดเป็นค่าเริ่มต้น** — ไม่ทำอะไรเลยถ้า env `MENTOR_AUTO_REMIND` ไม่ใช่ 'true' (เครื่อง dev ใช้ Gmail จริง)
 * ⛔ เตือนเมื่อ: พี่เลี้ยงมีงานค้างนาน ≥ 5 วัน (คิวงาน หรือเล่มรายงานส่งแล้วแต่ยังขาด สหกิจ 15/16)
 *    ห่างกัน ≥ 7 วัน (นับทุกชนิดการเตือน) · ไม่เกิน 4 ครั้งต่อ "รอบ" (รอบ = นับจากลิงก์ที่พี่เลี้ยงใช้ล่าสุด)
 * ⛔ เวลา "วันนี้/ชั่วโมงนี้" มาจาก Postgres (`NOW() AT TIME ZONE 'Asia/Bangkok'`) ไม่ใช่นาฬิกา Node
 * ⛔ จองแถว `mentor_reminders` ก่อนส่งเสมอ (ด่านห่างกันอยู่ใน INSERT เดียว) — ไม่ส่งซ้ำทับที่คนเพิ่งกดเตือน
 * ⛔ ล้มรายคนแล้วทำคนถัดไปต่อ ไม่หยุดทั้งรอบ · log เฉพาะ mentor_id ไม่ log อีเมล/ลิงก์
 * ⛔ ปลายทางสรุปถึงเจ้าหน้าที่มาจากทะเบียน (ผู้ใช้ role staff) ไม่เคยมาจากคำขอ
 */

// กติกาประกาศที่โมเดล (กันวงกลม) — re-export ให้ผู้ใช้ภายนอกมีที่อ้างอิงเดียว
export { AUTO_REMIND_AFTER_DAYS, AUTO_REMIND_EVERY_DAYS, AUTO_REMIND_MAX };
/** เพดานจำนวนอีเมลต่อหนึ่งรอบการรัน — กันบั๊กในกติกาทำให้เมลถล่มพี่เลี้ยงทั้งระบบ */
export const AUTO_REMIND_MAX_PER_RUN = 100;

/** ล็อกระดับ session ของ Postgres — สอง instance ของ backend รันงานนี้พร้อมกันไม่ได้ */
const ADVISORY_LOCK_KEY = 730_300_301;
const DIGEST_JOB_NAME = 'mentor_silent_digest';
const WINDOW_FIRST_HOUR = 9; // 09:00
const WINDOW_LAST_HOUR = 17; // ถึง 17:59

export const isAutoRemindEnabled = (): boolean => process.env.MENTOR_AUTO_REMIND === 'true';

/** เวลาไทยแยกส่วน — `isoWeekday` 1 = จันทร์ … 7 = อาทิตย์ (ตาม ISO / `EXTRACT(ISODOW)`) */
export interface BangkokNow {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  isoWeekday: number;
}

const readBangkokNow = async (): Promise<BangkokNow> => {
  const res = await query(
    `SELECT to_char(n, 'YYYY-MM-DD') AS date,
            EXTRACT(HOUR FROM n)::int AS hour,
            EXTRACT(ISODOW FROM n)::int AS iso_weekday
       FROM (SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS n) x`
  );
  const r = res.rows[0];
  return { date: r.date as string, hour: Number(r.hour), isoWeekday: Number(r.iso_weekday) };
};

/**
 * อยู่ในช่วงที่ระบบเตือนเองได้หรือไม่ — จันทร์-ศุกร์ 09:00-17:59 เวลาไทย และไม่ใช่วันหยุดที่ระบุ
 *
 * ไม่ส่ง `bangkokNow` = อ่านเวลาปัจจุบันจาก Postgres · ส่งมาเอง = ให้เทสต์ตรวจโดยไม่ต้องรอเวลาจริง
 * `holidays` = รายการ YYYY-MM-DD ที่ไม่ให้เตือน — ระบบยังไม่มีตารางวันหยุด (ดู utils/workingDays.ts) จึงเริ่มต้นว่าง
 */
export async function isAutoRemindWindow(
  bangkokNow?: BangkokNow,
  holidays: readonly string[] = []
): Promise<boolean> {
  const now = bangkokNow ?? (await readBangkokNow());
  if (now.isoWeekday < 1 || now.isoWeekday > 5) return false;
  if (now.hour < WINDOW_FIRST_HOUR || now.hour > WINDOW_LAST_HOUR) return false;
  return !holidays.includes(now.date);
}

export interface MentorAutoRemindResult {
  eligible: number; // เข้าเกณฑ์ส่งจริง (ก่อนติดเพดานต่อรอบ)
  reminded: number;
  skipped: number; // พี่เลี้ยงที่ตรวจแล้วไม่ได้ส่ง (ยังไม่ถึงเกณฑ์ / ห่างไม่ถึง 7 วัน / ครบเพดาน / เกินเพดานต่อรอบ)
  failed: number;
  silent: number; // เตือนครบเพดานแล้วแต่ยังมีงานค้าง
  digest: { sent: number; skippedReason?: string };
}

interface Candidate {
  mentor_id: number;
  name: string;
  email: string;
  company_name: string | null;
  last_reminded_at: Date | null;
  reminded_recently: boolean;
}

/** พี่เลี้ยงที่ยังใช้งานได้และมีนักศึกษาที่รับแล้วอย่างน้อยหนึ่งคน */
const loadCandidates = async (): Promise<Candidate[]> => {
  const res = await query(
    `SELECT m.mentor_id, m.name, u.email, c.name_th AS company_name,
            (SELECT MAX(r.created_at) FROM mentor_reminders r WHERE r.mentor_id = m.mentor_id) AS last_reminded_at,
            EXISTS (SELECT 1 FROM mentor_reminders r
                     WHERE r.mentor_id = m.mentor_id
                       AND r.created_at > NOW() - ($1::int * INTERVAL '1 day')) AS reminded_recently
       FROM mentors m
       JOIN users u ON u.user_id = m.mentor_id
       LEFT JOIN companies c ON c.company_id = m.company_id
      WHERE u.is_active = TRUE
        AND EXISTS (SELECT 1 FROM intent_forms i WHERE i.mentor_id = m.mentor_id AND i.status = 'accepted')
      ORDER BY m.mentor_id`,
    [AUTO_REMIND_EVERY_DAYS]
  );
  return res.rows.map((r) => ({
    mentor_id: Number(r.mentor_id),
    name: r.name as string,
    email: r.email as string,
    company_name: (r.company_name as string | null) ?? null,
    last_reminded_at: (r.last_reminded_at as Date | null) ?? null,
    reminded_recently: r.reminded_recently === true,
  }));
};

/**
 * สรุปประจำสัปดาห์ถึงเจ้าหน้าที่ — ส่งได้ไม่เกินหนึ่งรอบต่อ 7 วัน และจดลง `auto_job_log` เฉพาะเมื่อส่งสำเร็จอย่างน้อยหนึ่งฉบับ
 * (ส่งล้มทั้งหมด = ไม่จด รอบถัดไปลองใหม่)
 */
const sendSilentDigest = async (silent: SilentMentorDigestRow[]): Promise<{ sent: number; skippedReason?: string }> => {
  if (silent.length === 0) return { sent: 0, skippedReason: 'no_silent_mentors' };

  const recent = await query(
    `SELECT 1 FROM auto_job_log WHERE job_name = $1 AND ran_at > NOW() - INTERVAL '7 days' LIMIT 1`,
    [DIGEST_JOB_NAME]
  );
  if ((recent.rowCount ?? 0) > 0) return { sent: 0, skippedReason: 'already_sent_this_week' };

  // ปลายทางจากทะเบียนเท่านั้น: บัญชีเจ้าหน้าที่ที่ยังใช้งานได้
  const staff = await query(
    `SELECT DISTINCT u.email
       FROM users u JOIN user_roles r ON r.user_id = u.user_id
      WHERE r.role_name = 'staff' AND u.is_active = TRUE AND u.email IS NOT NULL`
  );
  if ((staff.rowCount ?? 0) === 0) return { sent: 0, skippedReason: 'no_staff_recipients' };

  const url = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?menu=mentor_followup`;
  let sent = 0;
  for (const row of staff.rows) {
    if (await sendMentorSilentDigestEmail(row.email as string, silent, url)) sent += 1;
  }
  if (sent === 0) return { sent: 0, skippedReason: 'all_sends_failed' };

  await query(`INSERT INTO auto_job_log (job_name, detail) VALUES ($1, $2)`, [
    DIGEST_JOB_NAME,
    JSON.stringify({ silent_mentors: silent.length, recipients_sent: sent }),
  ]);
  return { sent };
};

/**
 * ทำงานเตือนหนึ่งรอบ — ⛔ **ไม่ตรวจ env flag และไม่ตรวจช่วงเวลา** (ให้เทสต์เรียกตรงได้) ผู้เรียกจริงคือ `tickMentorAutoReminders`
 */
export async function runMentorAutoReminders(): Promise<MentorAutoRemindResult> {
  const result: MentorAutoRemindResult = {
    eligible: 0,
    reminded: 0,
    skipped: 0,
    failed: 0,
    silent: 0,
    digest: { sent: 0, skippedReason: 'not_run' },
  };

  // advisory lock ระดับ session ต้องล็อก/ปลดบน connection เดียวกัน — ยืม client แยกไว้เฉพาะเรื่องนี้
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const got = await lockClient.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [ADVISORY_LOCK_KEY]);
    locked = got.rows[0]?.ok === true;
    if (!locked) {
      result.digest = { sent: 0, skippedReason: 'another_run_in_progress' };
      return result;
    }

    const candidates = await loadCandidates();
    const autoCounts = await MentorFollowupModel.autoCycleCounts(candidates.map((c) => c.mentor_id));
    const silentRows: SilentMentorDigestRow[] = [];

    for (const c of candidates) {
      const autoCount = autoCounts.get(c.mentor_id) ?? 0;
      // เพิ่งถูกเตือนและยังไม่ครบเพดาน = ไม่มีอะไรให้ทำ ไม่ต้องเสียคิวรีหนักคำนวณ
      if (c.reminded_recently && autoCount < AUTO_REMIND_MAX) {
        result.skipped += 1;
        continue;
      }

      let claimId: number | null = null;
      let tokenId: number | null = null;
      let sent = false;
      try {
        const wait = await MentorFollowupModel.autoTriggerWait(c.mentor_id);
        if (wait === null || wait < AUTO_REMIND_AFTER_DAYS || !(await isPureMentor(c.mentor_id))) {
          result.skipped += 1;
          continue;
        }

        if (autoCount >= AUTO_REMIND_MAX) {
          // ครบเพดานแล้วยังมีงานค้างเข้าเกณฑ์ = เงียบ → ให้เจ้าหน้าที่ตาม (ธงบนหน้าคณะตามพี่เลี้ยง + สรุปประจำสัปดาห์)
          silentRows.push({
            name: c.name,
            companyName: c.company_name,
            email: c.email,
            oldestDaysWaiting: wait,
            lastRemindedAt: c.last_reminded_at,
          });
          result.silent += 1;
          result.skipped += 1;
          continue;
        }

        result.eligible += 1;
        if (result.reminded + result.failed >= AUTO_REMIND_MAX_PER_RUN) {
          result.skipped += 1;
          continue;
        }

        // จองสิทธิ์ก่อนส่ง (ด่านห่าง 7 วัน นับทุกชนิดการเตือน อยู่ใน INSERT เดียว)
        const claim = await MentorFollowupModel.claimReminder(c.mentor_id, null, {
          kind: 'auto',
          spacingHours: AUTO_REMIND_EVERY_DAYS * 24,
        });
        if (!claim) {
          result.skipped += 1;
          continue;
        }
        claimId = claim.reminderId;

        const summary = await MentorFollowupModel.fullSummary(c.mentor_id);
        const issued = await issueMentorLoginLink({
          userId: c.mentor_id,
          target: '/dashboard',
          ttlMs: MENTOR_LINK_TTL_SYSTEM_MS,
          skipCooldown: true,
        });
        if (!issued || 'cooledDown' in issued) {
          await MentorFollowupModel.releaseReminder(claimId);
          result.failed += 1;
          console.error(`[MentorAutoRemind] mentor ${c.mentor_id}: ออกลิงก์เข้าระบบไม่ได้`);
          continue;
        }
        tokenId = issued.tokenId;

        sent = await sendMentorReminderEmail(c.email, c.name, summary, issued.url, issued.expiresAt, true);
        if (!sent) {
          await revokeMentorLoginLink(tokenId);
          await MentorFollowupModel.releaseReminder(claimId);
          result.failed += 1;
          console.error(`[MentorAutoRemind] mentor ${c.mentor_id}: ส่งอีเมลไม่สำเร็จ`);
          continue;
        }

        result.reminded += 1;
        await writeAudit({
          action: AuditAction.MENTOR_REMINDER_AUTO_SENT,
          entityType: 'mentor_reminder',
          entityId: claimId,
          subjectId: c.mentor_id,
          detail: {
            mentor_id: c.mentor_id,
            auto_count: autoCount + 1,
            items: summary.items.length,
            reminder_id: claimId,
          },
        });
      } catch (err) {
        // คนเดียวพังไม่ทำให้ทั้งรอบหยุด — คืนสิ่งที่จองไว้แล้วไปคนถัดไป (log เฉพาะ mentor_id + ข้อความ error)
        if (!sent) {
          if (tokenId !== null) await revokeMentorLoginLink(tokenId).catch(() => undefined);
          if (claimId !== null) await MentorFollowupModel.releaseReminder(claimId).catch(() => undefined);
          result.failed += 1;
        }
        console.error(`[MentorAutoRemind] mentor ${c.mentor_id} ล้มเหลว:`, (err as Error)?.message ?? 'unknown error');
      }
    }

    try {
      result.digest = await sendSilentDigest(silentRows);
    } catch (err) {
      result.digest = { sent: 0, skippedReason: 'digest_failed' };
      console.error('[MentorAutoRemind] สรุปประจำสัปดาห์ถึงเจ้าหน้าที่ล้มเหลว:', (err as Error)?.message ?? 'unknown error');
    }
    return result;
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    lockClient.release();
  }
}

/** ตัวที่ scheduler เรียก — ไม่ทำอะไรถ้าปิดอยู่หรือนอกช่วงเวลา · ไม่โยน error (ห้ามทำให้โปรเซสล้ม) */
export async function tickMentorAutoReminders(): Promise<void> {
  if (!isAutoRemindEnabled()) return;
  try {
    if (!(await isAutoRemindWindow())) return;
    const r = await runMentorAutoReminders();
    console.log(
      `[MentorAutoRemind] eligible=${r.eligible} reminded=${r.reminded} skipped=${r.skipped} failed=${r.failed} ` +
        `silent=${r.silent} digest_sent=${r.digest.sent}${r.digest.skippedReason ? ` (${r.digest.skippedReason})` : ''}`
    );
  } catch (err) {
    console.error('[MentorAutoRemind] tick ล้มเหลว:', (err as Error)?.message ?? 'unknown error');
  }
}

const FIRST_TICK_DELAY_MS = 60 * 1000;
const TICK_EVERY_MS = 30 * 60 * 1000;

/** ปิดอยู่ = ไม่สร้าง timer เลย · เปิด = tick แรกหลังสตาร์ท 1 นาที แล้วทุก 30 นาที (`unref` ไม่รั้งโปรเซสตอนปิด) */
export function initMentorAutoRemindScheduler(): void {
  if (!isAutoRemindEnabled()) {
    console.log('[MentorAutoRemind] disabled');
    return;
  }
  setTimeout(() => void tickMentorAutoReminders(), FIRST_TICK_DELAY_MS).unref();
  setInterval(() => void tickMentorAutoReminders(), TICK_EVERY_MS).unref();
  console.log('[MentorAutoRemind] Initialized (ตรวจทุก 30 นาที · จันทร์-ศุกร์ 09:00-17:59 เวลาไทย).');
}
