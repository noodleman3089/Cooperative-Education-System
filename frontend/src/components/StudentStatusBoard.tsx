import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Button from './ui/Button';
import StudentAvatar from './StudentAvatar';
import { getErrorMessage } from '../utils/errors';
import {
  STEP_LABEL,
  TIER_LABEL,
  TIER_ORDER,
  isUrgentIssue,
  issueText,
  studentFullName,
  type AttentionTier,
  type StatusBoardPayload,
  type StatusBoardStudent,
} from '../utils/studentAttention';

/**
 * ตรวจสอบสถานะนักศึกษา — อาจารย์ที่ปรึกษา · หัวหน้าสาขา
 *
 * เรียงตามความสำคัญ: ต้องรีบ → ติดขัด/รอ → เป็นไปตามแผน → เสร็จสิ้น
 * ⛔ เซิร์ฟเวอร์เป็นคนจัดชั้นและเรียง (`GET /api/students/status-board`) หน้าจอแค่แสดงผล
 * ⛔ แสดงแค่สถานะ/ปัญหา ไม่มีเนื้อ 03 · ที่อยู่ · เบอร์ — รายละเอียดอยู่ที่หน้านักศึกษารายคน
 */

const PAGE = 30;

const TIER_STYLE: Record<AttentionTier, { tile: string; num: string }> = {
  urgent: {
    tile: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
    num: 'text-red-800 dark:text-red-200',
  },
  attention: {
    tile: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
    num: 'text-amber-900 dark:text-amber-200',
  },
  ontrack: {
    tile: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
    num: 'text-gray-900 dark:text-white',
  },
  done: {
    tile: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
    num: 'text-gray-900 dark:text-white',
  },
};

interface RowAction {
  label: string;
  onClick: () => void;
}

interface StudentStatusBoardProps {
  /** ผู้ใช้ปัจจุบัน — มีค่าเมื่อต้องการสลับ "เฉพาะที่ฉันดูแล" */
  myUserId?: number;
  /** ปุ่มท้ายแถว — คืน null = ไม่มีปุ่ม · คืนอาร์เรย์ได้หลายปุ่ม */
  actionFor?: (student: StatusBoardStudent) => RowAction | RowAction[] | null;
}

export const StudentStatusBoard: React.FC<StudentStatusBoardProps> = ({ myUserId, actionFor }) => {
  const [data, setData] = useState<StatusBoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = ต้องรีบ + ติดขัด (ค่าเริ่มต้น — ของที่ไม่ต้องทำอะไรไม่ขึ้นก่อน)
  const [tier, setTier] = useState<AttentionTier | null>(null);
  const [scope, setScope] = useState<'mine' | 'all' | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get('/students/status-board'));
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดสถานะนักศึกษาได้'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const isMine = useCallback(
    (s: StatusBoardStudent) => myUserId !== undefined && (s.advisor_id === myUserId || s.supervisor_id === myUserId),
    [myUserId]
  );

  const mineCount = useMemo(() => (data ? data.students.filter(isMine).length : 0), [data, isMine]);
  // ค่าเริ่มต้นของตัวสลับ: มีนักศึกษาของตัวเองก็เริ่มที่ "ของฉัน" ไม่งั้นทั้งสาขา
  const effectiveScope: 'mine' | 'all' = scope ?? (mineCount > 0 ? 'mine' : 'all');

  const scoped = useMemo(
    () => (data ? (effectiveScope === 'mine' ? data.students.filter(isMine) : data.students) : []),
    [data, effectiveScope, isMine]
  );
  const counts = useMemo(() => {
    const c: Record<AttentionTier, number> = { urgent: 0, attention: 0, ontrack: 0, done: 0 };
    for (const s of scoped) c[s.tier] += 1;
    return c;
  }, [scoped]);
  const shown = scoped.filter((s) => (tier ? s.tier === tier : s.tier === 'urgent' || s.tier === 'attention'));

  if (error) {
    return (
      <AlertBanner
        variant="error"
        message={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              ลองใหม่
            </Button>
          </div>
        }
      />
    );
  }
  if (!data) {
    return <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-400">กำลังโหลดสถานะนักศึกษา...</p>;
  }

  return (
    <section data-testid="status-board" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">ตรวจสอบสถานะนักศึกษา</h2>
          <p className="text-[13px] text-gray-600 dark:text-gray-400">
            เรียงตามความสำคัญ · ทั้งสาขา {data.students.length} คน
          </p>
        </div>
        {myUserId !== undefined && (
          <div
            data-testid="status-board-scope"
            data-scope={effectiveScope}
            className="inline-flex gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800"
          >
            {(
              [
                ['mine', `เฉพาะที่ฉันดูแล (${mineCount})`],
                ['all', `ทั้งสาขา (${data.students.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setScope(key);
                  setLimit(PAGE);
                }}
                className={`min-h-9 rounded-lg px-3 text-[13px] ${
                  effectiveScope === key
                    ? 'bg-white font-bold text-blue-900 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                    : 'font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {TIER_ORDER.map((t) => {
          const selected = tier === t;
          return (
            <button
              key={t}
              type="button"
              data-testid={`status-board-tile-${t}`}
              data-count={counts[t]}
              aria-pressed={selected}
              onClick={() => {
                setTier(selected ? null : t);
                setLimit(PAGE);
              }}
              className={`rounded-xl border p-3 text-left transition-colors ${TIER_STYLE[t].tile} ${
                selected ? 'ring-2 ring-brand-blue' : 'hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <span className="block text-[13px] font-semibold text-gray-800 dark:text-gray-200">{TIER_LABEL[t]}</span>
              <b className={`block text-2xl font-extrabold tabular-nums ${TIER_STYLE[t].num}`}>{counts[t]}</b>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-600 dark:text-gray-400">
        {tier ? `แสดงเฉพาะ "${TIER_LABEL[tier]}"` : 'แสดง "ต้องรีบ" และ "ติดขัด / รอ" — กดช่องข้างบนเพื่อดูกลุ่มอื่น'}
      </p>

      {shown.length === 0 ? (
        <p
          data-testid="status-board-empty"
          className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
        >
          {tier ? 'ไม่มีนักศึกษาในกลุ่มนี้' : 'ไม่มีนักศึกษาที่ต้องรีบหรือติดขัดในตอนนี้'}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.slice(0, limit).map((s) => {
            const made = actionFor?.(s) ?? null;
            const actions = made === null ? [] : Array.isArray(made) ? made : [made];
            return (
              <li
                key={s.student_id}
                data-testid={`status-board-row-${s.student_id}`}
                data-tier={s.tier}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 dark:border-gray-700 dark:bg-gray-900"
              >
                <StudentAvatar firstName={s.first_name} lastName={s.last_name} image={s.profile_image} size={40} />
                <div className="min-w-0 flex-[1_1_220px]">
                  <span className="block break-words text-[15px] font-bold text-gray-900 dark:text-gray-100">
                    {studentFullName(s)} <span className="text-xs font-normal text-gray-600 dark:text-gray-400">· {s.student_code}</span>
                  </span>
                  <span className="block break-words text-[13px] text-gray-700 dark:text-gray-300">
                    {STEP_LABEL[s.step]}
                    {s.company_name ? ` · ${s.company_name}` : ''}
                  </span>
                </div>
                <div className="flex min-w-0 flex-[1_1_200px] flex-wrap gap-1.5">
                  {s.issues.length === 0 ? (
                    <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-bold text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
                      {s.tier === 'done' ? 'เสร็จสิ้น' : 'ปกติ'}
                    </span>
                  ) : (
                    s.issues.map((i) => (
                      <span
                        key={i.code}
                        className={`max-w-full break-words rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                          isUrgentIssue(i)
                            ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                            : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                        }`}
                      >
                        {issueText(i)}
                      </span>
                    ))
                  )}
                </div>
                {actions.map((action, idx) => (
                  <Button
                    key={action.label}
                    variant="secondary"
                    className="min-h-11 shrink-0"
                    data-testid={`status-board-open-${s.student_id}${idx === 0 ? '' : `-${idx}`}`}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {shown.length > limit && (
        <div className="text-center">
          <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
            แสดงเพิ่ม (เหลือ {shown.length - limit} คน)
          </Button>
        </div>
      )}
    </section>
  );
};

export default StudentStatusBoard;
