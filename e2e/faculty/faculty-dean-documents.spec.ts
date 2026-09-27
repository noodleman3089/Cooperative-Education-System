import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-H1 · `GET /documents` ส่ง `created_at` และ `days_pending` — spec-H ข้อ 2 · 15.2
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. หนังสือรอลงนามบอกได้ว่าค้างมากี่วัน (คิดที่ฐาน ตามวันของไทย)
 *   2. หนังสือที่ไม่รู้วันออก (`created_at` NULL) ต้องเป็น "ไม่ทราบ" (`null`) ไม่ใช่ 0 วัน
 *   3. หนังสือที่ลงนามแล้วไม่มี `days_pending` · เจ้าหน้าที่ได้คีย์เดียวกัน (เพิ่มคีย์ ไม่เปลี่ยนของเดิม)
 */

type Doc = { doc_id: number; status: string; created_at: string | null; days_pending: number | null; student_code: string };

test.describe('SB-H1 · คิวหนังสือของคณบดี', () => {
  let pendingId: number;
  let unknownId: number;
  let signedId: number;

  test.beforeEach(async () => {
    await seedTestData();
    const sid = await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");
    const cid = await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1');
    pendingId = (await dbValue<number>(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, status, created_at)
       VALUES ('H1/1', 'cover_letter', $1, $2, 'pending_sign', NOW() - INTERVAL '2 days') RETURNING doc_id`,
      [sid, cid]
    ))!;
    unknownId = (await dbValue<number>(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, status, created_at)
       VALUES ('H1/2', 'send_letter', $1, $2, 'pending_sign', NULL) RETURNING doc_id`,
      [sid, cid]
    ))!;
    signedId = (await dbValue<number>(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, status, created_at, dean_signature_date)
       VALUES ('H1/3', 'cover_letter', $1, $2, 'signed', NOW() - INTERVAL '9 days', NOW()) RETURNING doc_id`,
      [sid, cid]
    ))!;
  });

  test('D1: รอลงนามมี days_pending · ไม่รู้วันออก = null · ลงนามแล้ว = null', async ({ request }) => {
    await apiLoginAs(request, 'dean1');
    const res = await request.get(`${API_URL}/documents`);
    expect(res.status()).toBe(200);
    const docs = (await res.json()) as Doc[];
    const byId = (id: number) => docs.find((d) => d.doc_id === id)!;

    expect(byId(pendingId).days_pending).toBe(2);
    expect(byId(pendingId).created_at).toBeTruthy();
    expect(byId(unknownId).created_at).toBeNull();
    expect(byId(unknownId).days_pending).toBeNull();
    expect(byId(signedId).days_pending).toBeNull();
    // คีย์เดิมที่หน้าจอคณบดีและ E2E placement-happy-path อ่าน ต้องยังอยู่
    expect(byId(pendingId).student_code).toBeTruthy();
  });

  test('D2: เจ้าหน้าที่ได้คีย์เดียวกัน · นักศึกษาและอาจารย์เรียกไม่ได้', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const docs = (await (await request.get(`${API_URL}/documents`)).json()) as Doc[];
    expect(docs.find((d) => d.doc_id === pendingId)?.days_pending).toBe(2);

    for (const who of ['student2', 'advisor1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/documents`)).status(), who).toBe(403);
    }
  });
});
