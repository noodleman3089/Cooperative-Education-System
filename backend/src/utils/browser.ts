/**
 * เปิด Chrome สำหรับแปลง HTML เป็น PDF — จุดเดียวของทั้งระบบ
 *
 * puppeteer เป็น ESM ล้วน (`"type": "module"` ใน package ของมัน) จึงถูก `require`
 * ตรงๆ จากไฟล์ CommonJS ไม่ได้ภายใต้ `moduleResolution: node16` — ต้อง dynamic import
 * ผลพลอยได้: ไม่ถูกโหลดตอนสตาร์ทเซิร์ฟเวอร์ แต่โหลดตอนออกเอกสารจริงเท่านั้น
 *
 * ⚠️ ค่าเริ่มต้นคือ **เปิด sandbox** — เดิมทั้ง 3 จุดที่เรียก puppeteer ใส่
 * `--no-sandbox` ไว้ตายตัว ซึ่งแปลว่าถ้าวันหนึ่งมีเนื้อหาที่หลุด escape ของ
 * Handlebars ไปถึง renderer ช่องโหว่ของ Chrome จะกลายเป็นสิทธิ์ระดับโปรเซส
 * ของเซิร์ฟเวอร์ทันที · sandbox คือชั้นที่ทำให้ chain นั้นจบตรงกลาง
 *
 * ตั้ง `PUPPETEER_NO_SANDBOX=true` เฉพาะตอนรันใน container ที่ไม่มี SYS_ADMIN
 * ซึ่งเป็นที่เดียวที่ sandbox ของ Chrome เปิดไม่ได้จริงๆ
 *
 * ชนิดที่คืนมาปล่อยให้ TS อนุมานเอง — `import type { Browser } from 'puppeteer'`
 * ใช้ไม่ได้ที่นี่ ต้องมี resolution-mode เพราะไฟล์นี้ emit เป็น CommonJS (TS1541)
 */
export async function launchPdfBrowser() {
  const puppeteer = (await import('puppeteer')).default;
  const noSandbox = process.env.PUPPETEER_NO_SANDBOX === 'true';

  return puppeteer.launch({
    headless: true,
    args: noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });
}
