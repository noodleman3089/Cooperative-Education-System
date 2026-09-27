import { test, expect, request as playwrightRequest } from '@playwright/test';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';

/**
 * Rate limit — อีกช่องที่ CLAUDE.md บันทึกไว้ว่า "ไม่เคยทดสอบเลย"
 *
 * ตัวเลขที่ตั้งไว้มีผลเฉพาะตอน `NODE_ENV=production` (dev หลวมกว่าโดยตั้งใจ
 * ไม่งั้น E2E ชุดนี้จะยิงชนเพดานตัวเอง) จึงทดสอบด้วยเซิร์ฟเวอร์ปกติของ Playwright
 * ไม่ได้ — ต้องสตาร์ท backend อีกตัวบนพอร์ตอื่นด้วย env แบบ production แล้วยิงใส่
 *
 *   /api/auth  → 10 ครั้ง / 15 นาที
 *   /api ทั่วไป → 3000 ครั้ง / 15 นาที (เดิม 100 — แท็บแดชบอร์ดเดียวก็ใช้ ≈ 90 · เจ้าของตัดสิน 2026-09-21)
 *
 * ใช้ฐานข้อมูลเดิม แต่ยิงเฉพาะคำขอที่ล้มเหลว (ล็อกอินผิด) กับ endpoint อ่านอย่างเดียว
 * จึงไม่แตะข้อมูลของเทสต์อื่น
 */

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | undefined;

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const probe = await playwrightRequest.newContext();
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      try {
        const res = await probe.get(`${BASE}/health`, { timeout: 2_000 });
        if (res.ok()) return;
      } catch {
        // ยังไม่ขึ้น
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`เซิร์ฟเวอร์ทดสอบไม่ขึ้นภายใน ${timeoutMs}ms`);
  } finally {
    await probe.dispose();
  }
}

test.describe('Rate limiting (โหมด production จริง)', () => {
  test.beforeAll(async () => {
    // คำสั่งเป็นสตริงเดียวเพราะต้องผ่าน shell (npx เป็น .cmd บน Windows) —
    // การส่ง args array คู่กับ shell:true ทำให้ Node เตือนเรื่องการต่อสตริงที่ไม่ escape
    server = spawn('npx ts-node src/index.ts', {
      cwd: path.resolve(__dirname, '../../backend'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
        // ต้องผ่านด่านตรวจ env ของ production (validateEnv.ts)
        JWT_SECRET: 'rate-limit-test-secret-'.padEnd(64, 'x'),
        FRONTEND_URL: 'https://localhost:5173',
        ALLOW_SIMULATED_SSO: 'false',
        ENABLE_TEST_ROUTES: 'false',
      },
      shell: true,
      stdio: 'ignore',
    });

    await waitForServer();
  });

  test.afterAll(async () => {
    if (!server?.pid) return;
    // npx สร้างลูกหลาน การ kill แค่ตัวแม่จะทิ้งพอร์ตค้างไว้
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // โปรเซสอาจตายไปแล้ว
      }
    } else {
      server.kill('SIGKILL');
    }
  });

  // ⛔ ต้องรันก่อนเคสถัดไปที่ใช้โควตา /api/auth ของ IP นี้จนหมด
  test('ล็อกอินสำเร็จไม่กินโควตา — ใช้งานปกติเกิน 10 ครั้งต้องไม่โดนบล็อก', async () => {
    const client = await playwrightRequest.newContext({ baseURL: BASE });
    try {
      // เดิมนับทุกคำขอ รวมที่สำเร็จ (และ `GET /auth/me` ทุกการโหลดหน้า) → ผู้ใช้จริงโดนดีดออก
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await client.post('/api/auth/login', {
          data: { email: 'student2@test.com', password: 'password123' },
        });
        statuses.push(res.status());
      }
      expect(statuses.every((s) => s === 200), statuses.join(',')).toBe(true);
    } finally {
      await client.dispose();
    }
  });

  test('/api/auth ปิดประตูหลังพยายามล็อกอินครบ 10 ครั้ง', async () => {
    const client = await playwrightRequest.newContext({ baseURL: BASE });

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 13; i++) {
        const res = await client.post('/api/auth/login', {
          data: { email: 'student2@test.com', password: 'wrong-password' },
        });
        statuses.push(res.status());
      }

      const blockedAt = statuses.indexOf(429);
      expect(blockedAt, `ยิง 13 ครั้งแล้วไม่โดนบล็อกเลย: ${statuses.join(',')}`).toBeGreaterThan(
        -1
      );
      // เพดานคือ 10 — ครั้งที่ 11 (index 10) ต้องเริ่มโดน และต้องไม่บล็อกก่อนถึงเพดาน
      expect(blockedAt).toBe(10);

      // โดนแล้วต้องโดนต่อเนื่อง ไม่ใช่หลุดสลับไปมา
      expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
    } finally {
      await client.dispose();
    }
  });

  test('การโดนบล็อกที่ /api/auth ไม่ปิดทั้งเว็บ และมี header บอกโควตาที่เหลือ', async () => {
    const client = await playwrightRequest.newContext({ baseURL: BASE });

    try {
      // เทสต์ก่อนหน้าใช้โควตา auth หมดแล้ว (bucket เดียวกันเพราะ IP เดียวกัน)
      // แต่ endpoint อื่นต้องยังใช้ได้ตามปกติ
      const health = await client.get('/health');
      expect(health.status()).toBe(200);

      const semester = await client.get('/api/semesters/active');
      expect(semester.status()).not.toBe(429);

      // standardHeaders: true — ผู้เรียกต้องรู้ได้ว่าเหลือโควตาเท่าไหร่
      // ⛔ 3000 ไม่ใช่ 100 — 100 ทำให้ระบบล่มทั้งมหาวิทยาลัยเมื่อออกเน็ตผ่าน IP เดียว
      expect(semester.headers()['ratelimit-limit']).toBe('3000');
      expect(semester.headers()['ratelimit-remaining']).toBeDefined();
    } finally {
      await client.dispose();
    }
  });

  test('/api ทั่วไปปิดประตูหลังครบโควตา (3000 ครั้ง)', async () => {
    const client = await playwrightRequest.newContext({ baseURL: BASE });

    try {
      let firstBlocked = -1;
      // เทสต์ก่อนหน้าใช้โควตา general ไปแล้วบางส่วน (auth 13 + อีก 2) จึงนับจากของจริง
      // ที่ header บอก แทนที่จะสมมติว่าเริ่มจากศูนย์
      const probe = await client.get('/api/semesters/active');
      const remaining = Number(probe.headers()['ratelimit-remaining'] ?? '0');

      for (let i = 0; i <= remaining + 2; i++) {
        const res = await client.get('/api/semesters/active');
        if (res.status() === 429) {
          firstBlocked = i;
          break;
        }
      }

      expect(firstBlocked, 'ยิงจนเกินโควตาแล้วยังไม่โดนบล็อก').toBeGreaterThan(-1);

      const blocked = await client.get('/api/semesters/active');
      expect(blocked.status()).toBe(429);
      expect((await blocked.json()).message).toContain('Too many requests');
    } finally {
      await client.dispose();
    }
  });
});
