import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

/**
 * Walkthrough — เดินตามโฟลว์จริงผ่านหน้าเว็บ ถ่ายภาพเต็มหน้าทุกขั้น แล้วรวมเป็น `index.html` 1 ไฟล์ต่อโฟลว์
 * ให้เจ้าของไล่ดูหาจุดที่ UI แปลก/ชวนสะดุด · **ไม่ใช่ชุดเทสต์** — แยกอยู่ที่ `e2e/walkthrough/`
 * และ `playwright.walkthrough.config.ts` (config หลักกันไว้ด้วย testIgnore) จึงไม่นับในชุดเต็ม
 *
 * ผลลัพธ์ลงที่ `เอกสาร/walkthrough/<flow>/` เท่านั้น (gitignore ทั้งโฟลเดอร์ `เอกสาร/`)
 * ⛔ ตัวจับสิ่งแปลกแค่ **บันทึก** ลง flags ไม่ทำให้เทสต์ล้ม
 */

export interface Walk {
  /** ผูกตัวเก็บ console error / pageerror — เรียกกับทุก page ที่ใช้ */
  watch(page: Page): void;
  /** ถ่ายภาพ fullPage หลังการกระทำ + บันทึกขั้น */
  step(page: Page, who: string, caption: string): Promise<void>;
  /** เขียน index.html */
  finish(): Promise<void>;
}

interface StepRecord {
  n: number;
  who: string;
  caption: string;
  url: string;
  time: string;
  file: string;
  flags: string[];
}

const ROOT_OUT = path.resolve(__dirname, '../../เอกสาร/walkthrough');
// คำที่ไม่ควรโผล่บนจอ — เป็นคำเดี่ยวเท่านั้น (word boundary) กันไปจับ "nullable" ฯลฯ
const BAD_WORDS = /\b(undefined|null|NaN)\b|\[object Object\]/g;

const MAX_HEIGHT = 6000;
// เสียงรบกวนที่รู้ที่มาแล้ว ไม่ใช่ความผิดปกติของหน้า — ถ้าบันทึกจะกลบของจริง
//  · 401 ของ /api/auth/me = เช็ค session ก่อนล็อกอิน (ปกติ) · GSI = สคริปต์ Google Sign-In ปฏิเสธ origin localhost
const KNOWN_NOISE = [/status of 401[^]*\/api\/auth\/me/, /\/gsi\/|GSI_LOGGER/];

const escapeHtml =(s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** ตัดโดเมนออก เหลือ path + query + hash */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

export function createWalk(flow: string, title: string): Walk {
  const dir = path.join(ROOT_OUT, flow);
  const steps: StepRecord[] = [];
  const pageErrors: string[] = [];

  // ล้างเฉพาะ .png / index.html ของโฟลว์นี้ — ไม่แตะอย่างอื่น ไม่แตะโฟลเดอร์แม่
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f === 'index.html' || f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
  }

  /** page.evaluate ที่ทนต่อการนำทางกลางคัน (context ถูกทำลาย) — ลองซ้ำหนึ่งครั้ง */
  async function safeEval<T>(page: Page, fn: () => T, fallback: T): Promise<T> {
    for (let i = 0; i < 2; i++) {
      try {
        return await page.evaluate(fn);
      } catch {
        await page.waitForTimeout(300);
      }
    }
    return fallback;
  }

  return {
    watch(page) {
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const loc = msg.location().url;
        const text = `console.error: ${msg.text()}${loc ? ` (${pathOf(loc)})` : ''}`;
        if (KNOWN_NOISE.some((re) => re.test(text))) return;
        pageErrors.push(clip(text, 240));
      });
      page.on('pageerror', (err) => {
        pageErrors.push(clip(`pageerror: ${err.message}`, 240));
      });
    },

    async step(page, who, caption) {
      // รอหน้านิ่ง: ไม่มี screen-loading ค้าง (เหมือน goToMenu) + network นิ่งสั้นๆ
      // ไม่ใช้ networkidle เป็นเงื่อนไขเดียว — แอป poll อยู่ จึงให้ timeout แล้วถ่ายต่อ
      await page
        .waitForFunction(() => !document.querySelector('[data-testid="screen-loading"]'), null, { timeout: 10_000 })
        .catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
      await page.waitForTimeout(300);

      const flags: string[] = [];

      // (1) console error / pageerror ตั้งแต่ขั้นก่อนหน้า
      if (pageErrors.length > 0) {
        const uniq = [...new Set(pageErrors)];
        for (const e of uniq.slice(0, 5)) flags.push(e);
        if (uniq.length > 5) flags.push(`…และอีก ${uniq.length - 5} ข้อความ`);
        pageErrors.length = 0;
      }

      // (2) หน้าเลื่อนแนวนอน
      const overflow = await safeEval(
        page,
        () => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }),
        { sw: 0, cw: 0 }
      );
      if (overflow.sw > overflow.cw) {
        flags.push(`หน้าเลื่อนแนวนอน: scrollWidth ${overflow.sw} > clientWidth ${overflow.cw}`);
      }

      // (3) คำต้องห้ามบนจอ
      const text = await safeEval(page, () => document.body.innerText, '');
      const seen = new Set<string>();
      for (const m of text.matchAll(BAD_WORDS)) {
        const at = m.index ?? 0;
        const snippet = text.slice(Math.max(0, at - 25), at + m[0].length + 25).replace(/\s+/g, ' ');
        if (seen.has(snippet)) continue;
        seen.add(snippet);
        if (seen.size <= 5) flags.push(`ข้อความบนจอมีคำ "${m[0]}" — …${snippet}…`);
      }

      const n = steps.length + 1;
      const file = `${String(n).padStart(2, '0')}.png`;

      // แอปเลื่อนใน container ข้างใน (main · modal) ไม่ใช่ที่ document — fullPage อย่างเดียวได้แค่ความสูง viewport
      // จึงขยาย viewport ตามส่วนที่ถูกซ่อนในตัวเลื่อน (วัดซ้ำ เพราะ max-h ของ modal อิง vh) แล้วคืนค่าหลังถ่าย
      const original = page.viewportSize();
      try {
        if (original) {
          for (let i = 0; i < 4; i++) {
            const hidden = await safeEval(
              page,
              () => {
                let max = 0;
                for (const el of Array.from(document.querySelectorAll('*'))) {
                  if (el.clientHeight === 0 || el.scrollHeight <= el.clientHeight + 1) continue;
                  if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
                    max = Math.max(max, el.scrollHeight - el.clientHeight);
                  }
                }
                return max;
              },
              0
            );
            const current = page.viewportSize()?.height ?? original.height;
            if (hidden <= 0 || current >= MAX_HEIGHT) break;
            await page.setViewportSize({ width: original.width, height: Math.min(current + hidden, MAX_HEIGHT) });
            await page.waitForTimeout(250);
          }
        }
        await page.screenshot({ path: path.join(dir, file), fullPage: true });
      } finally {
        if (original) await page.setViewportSize(original);
      }

      steps.push({
        n,
        who,
        caption,
        url: page.url(),
        time: new Date().toLocaleTimeString('th-TH', { hour12: false }),
        file,
        flags,
      });
    },

    async finish() {
      const flagged = steps.filter((s) => s.flags.length > 0).length;
      const created = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });

      const toc = steps
        .map(
          (s) =>
            `<li><a href="#s${s.n}"${s.flags.length ? ' class="warn"' : ''}>${escapeHtml(s.caption)}</a></li>`
        )
        .join('\n');

      const body = steps
        .map((s) => {
          const flagsHtml = s.flags.length
            ? `<ul class="flags">${s.flags.map((f) => `<li>⚠ ${escapeHtml(f)}</li>`).join('')}</ul>`
            : '';
          return `<section id="s${s.n}" class="step${s.flags.length ? ' flagged' : ''}">
  <h2><span class="num">${s.n}</span><span class="who">${escapeHtml(s.who)}</span>${escapeHtml(s.caption)}</h2>
  <p class="meta"><code>${escapeHtml(pathOf(s.url))}</code> · ${escapeHtml(s.time)}</p>
  ${flagsHtml}
  <a href="${s.file}" target="_blank" rel="noopener"><img src="${s.file}" loading="lazy" alt="ขั้นที่ ${s.n}"></a>
</section>`;
        })
        .join('\n');

      const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { --bg:#f8fafc; --fg:#0f172a; --muted:#475569; --card:#ffffff; --line:#cbd5e1; --accent:#1e40af; --warn-bg:#fef3c7; --warn-fg:#78350f; --warn-line:#f59e0b; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0b1120; --fg:#e2e8f0; --muted:#94a3b8; --card:#111827; --line:#334155; --accent:#93c5fd; --warn-bg:#422006; --warn-fg:#fde68a; --warn-line:#b45309; }
}
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--fg); font-family:system-ui,"Noto Sans Thai",sans-serif; line-height:1.55; }
main { max-width:1100px; margin:0 auto; }
h1 { margin:0 0 4px; font-size:1.6rem; }
.sub { color:var(--muted); margin:0 0 20px; }
.sub b { color:var(--fg); }
nav ol { columns:2 360px; padding-left:1.4rem; margin:0 0 32px; }
nav a { color:var(--accent); text-decoration:none; }
nav a:hover { text-decoration:underline; }
nav a.warn { background:var(--warn-bg); color:var(--warn-fg); padding:0 4px; border-radius:4px; }
.step { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin:0 0 24px; }
.step.flagged { border-color:var(--warn-line); }
.step h2 { margin:0 0 4px; font-size:1.1rem; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.num { background:var(--accent); color:var(--bg); border-radius:999px; min-width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; font-size:.85rem; padding:0 6px; }
.who { border:1px solid var(--line); border-radius:6px; padding:0 8px; font-size:.8rem; color:var(--muted); font-weight:600; }
.meta { margin:0 0 8px; color:var(--muted); font-size:.85rem; }
.flags { list-style:none; margin:0 0 10px; padding:8px 12px; background:var(--warn-bg); color:var(--warn-fg); border:1px solid var(--warn-line); border-radius:8px; font-size:.85rem; }
.flags li { margin:2px 0; word-break:break-word; }
img { max-width:100%; height:auto; border:1px solid var(--line); border-radius:8px; display:block; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="sub">สร้างเมื่อ ${escapeHtml(created)} · <b>${steps.length}</b> ขั้น · ติดป้ายเตือน <b>${flagged}</b> ขั้น</p>
<nav><ol>
${toc}
</ol></nav>
${body}
</main>
</body>
</html>
`;
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    },
  };
}
