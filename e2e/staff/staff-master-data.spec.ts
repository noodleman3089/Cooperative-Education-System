import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs } from '../helpers/auth';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbValue } from '../helpers/db';

/**
 * ทะเบียนคณะและสาขาวิชา (spec-E ข้อ 10.1 · SB7)
 *
 * ก่อนหน้านี้ `routes/masterData.ts` มี `GET /` อย่างเดียว — คณะเปิดสาขาใหม่แล้ว
 * ระบบใช้ไม่ได้จนกว่าจะมีคนเข้าไป INSERT ในฐานข้อมูลตรง ๆ
 *
 * ⛔ สิ่งที่ไฟล์นี้คุมไม่ใช่ "เพิ่มลบแก้ได้ไหม" แต่คือ **สามอย่างที่พังเงียบ**:
 *    1. `GET /` ต้องเปิดสาธารณะต่อไป (หน้าสมัครใช้เติม dropdown ก่อนมี session)
 *       แต่เส้นเขียนทุกเส้นต้องเป็นของ `staff` เท่านั้น — ไฟล์ route ไม่มีด่านระดับไฟล์
 *       ให้พึ่ง ลืมแปะด่านทีละเส้นเมื่อไหร่คือเปิดโล่ง ไม่ใช่ 401
 *    2. **ลบคณะพาสาขาใต้คณะหายไปด้วย** (`ON DELETE CASCADE`) ต้องกันเองก่อนถึงฐาน
 *    3. `personnel` และ `job_post_majors` ก็อ้าง `major_id` เหมือนกัน — เช็คแต่
 *       `students` แล้วปล่อยผ่าน = ผู้ใช้ได้ 500 จาก FK error แทนที่จะรู้ว่าติดอะไร
 */

async function facultyIdOf(name: string): Promise<number> {
  return (await dbValue<number>(
    'SELECT faculty_id FROM master_faculty WHERE faculty_name_th = $1',
    [name]
  ))!;
}

async function majorIdOf(code: string): Promise<number> {
  return (await dbValue<number>('SELECT major_id FROM master_major WHERE major_code = $1', [code]))!;
}

test.describe('ทะเบียนคณะและสาขาวิชา (spec-E SB7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('อ่านได้ทุกคน แต่เขียนได้เฉพาะเจ้าหน้าที่', async ({ request }) => {
    // ⛔ ไม่ล็อกอินก็ต้องอ่านได้ — หน้าสมัครเรียกเส้นนี้ก่อนจะมี session
    const publicRead = await request.get(`${API_URL}/master-data`);
    expect(publicRead.status()).toBe(200);
    expect((await publicRead.json()).faculties.length).toBeGreaterThan(0);

    const facultyId = await facultyIdOf('คณะวิทยาศาสตร์');
    const majorId = await majorIdOf('CS01');

    // ไม่ล็อกอิน = 401 · ล็อกอินแต่ผิดบทบาท = 403 · ทั้งสองอย่างต้องไม่ใช่ 200
    const anon = await request.post(`${API_URL}/master-data/faculties`, {
      data: { faculty_name_th: 'คณะที่ไม่ควรถูกสร้าง' },
    });
    expect(anon.status()).toBe(401);

    for (const account of ['student1', 'advisor1', 'company1', 'dean1'] as const) {
      await apiLoginAs(request, account);
      const calls = [
        request.post(`${API_URL}/master-data/faculties`, { data: { faculty_name_th: 'x' } }),
        request.put(`${API_URL}/master-data/faculties/${facultyId}`, {
          data: { faculty_name_th: 'x' },
        }),
        request.delete(`${API_URL}/master-data/faculties/${facultyId}`),
        request.post(`${API_URL}/master-data/majors`, {
          data: { faculty_id: facultyId, major_code: 'X99', major_name_th: 'x' },
        }),
        request.put(`${API_URL}/master-data/majors/${majorId}`, {
          data: { faculty_id: facultyId, major_code: 'X99', major_name_th: 'x' },
        }),
        request.delete(`${API_URL}/master-data/majors/${majorId}`),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status(), `${account} ต้องเขียนทะเบียนไม่ได้`).toBe(403);
      }
    }

    // และต้องไม่มีอะไรถูกเขียนลงไปจริง
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM master_faculty WHERE faculty_name_th = $1', ['x'])
    ).toBe('0');
  });

  test('เพิ่มคณะและสาขาได้ · ชื่อคณะซ้ำและรหัสสาขาซ้ำถูกปฏิเสธพร้อมบอกว่าซ้ำกับอะไร', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');

    const created = await request.post(`${API_URL}/master-data/faculties`, {
      data: { faculty_name_th: 'คณะเทคโนโลยีอุตสาหกรรม' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const facultyId = (await created.json()).faculty_id;

    // ชื่อว่างไม่ได้ — `faculty_name_th` เป็น NOT NULL และชื่อว่างคือแถวที่ไม่มีความหมาย
    expect((await request.post(`${API_URL}/master-data/faculties`, { data: {} })).status()).toBe(400);

    const dupFaculty = await request.post(`${API_URL}/master-data/faculties`, {
      data: { faculty_name_th: '  คณะเทคโนโลยีอุตสาหกรรม  ' },
    });
    expect(dupFaculty.status()).toBe(409);
    expect(await dupFaculty.text()).toContain('คณะเทคโนโลยีอุตสาหกรรม');

    const major = await request.post(`${API_URL}/master-data/majors`, {
      data: { faculty_id: facultyId, major_code: 'IND01', major_name_th: 'สาขาวิชาเทคโนโลยีการผลิต' },
    });
    expect(major.status(), await major.text()).toBe(201);

    // ⛔ ข้อความต้องบอกว่าซ้ำกับ "สาขาไหน" ไม่ใช่ "รหัสซ้ำ" ลอย ๆ (สเปกข้อ 10.1)
    const dupCode = await request.post(`${API_URL}/master-data/majors`, {
      data: { faculty_id: facultyId, major_code: 'cs01', major_name_th: 'ชื่ออะไรก็ได้' },
    });
    expect(dupCode.status()).toBe(409);
    expect(await dupCode.text()).toContain('สาขาวิชาวิทยาการคอมพิวเตอร์');

    // คณะที่ไม่มีอยู่จริง = 404 ไม่ใช่ FK error 500
    const noFaculty = await request.post(`${API_URL}/master-data/majors`, {
      data: { faculty_id: 999999, major_code: 'ZZ99', major_name_th: 'x' },
    });
    expect(noFaculty.status()).toBe(404);
  });

  test('แก้ชื่อคณะและย้ายสาขาข้ามคณะได้ · ลง audit_log ทุกครั้ง', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const sci = await facultyIdOf('คณะวิทยาศาสตร์');
    const eng = await facultyIdOf('คณะวิศวกรรมศาสตร์');
    const mm = await majorIdOf('MM01');

    const renamed = await request.put(`${API_URL}/master-data/faculties/${sci}`, {
      data: { faculty_name_th: 'คณะวิทยาศาสตร์และเทคโนโลยี' },
    });
    expect(renamed.status(), await renamed.text()).toBe(200);

    const moved = await request.put(`${API_URL}/master-data/majors/${mm}`, {
      data: { faculty_id: eng, major_code: 'MM01', major_name_th: 'สาขาวิชามัลติมีเดียและแอนิเมชัน' },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    expect(await dbValue<number>('SELECT faculty_id FROM master_major WHERE major_id = $1', [mm])).toBe(
      eng
    );

    // ⛔ `writeAudit` เป็น fire-and-forget — ต้อง poll ไม่ใช่อ่านทันที
    await expect
      .poll(
        async () =>
          Number(
            await dbValue<string>(
              `SELECT COUNT(*) FROM audit_log WHERE action IN ($1, $2)`,
              ['master_data.faculty_updated', 'master_data.major_updated']
            )
          ),
        { timeout: 5000 }
      )
      .toBe(2);

    // ชื่อเดิมต้องอยู่ใน detail — "ใครเปลี่ยนจากอะไรเป็นอะไร" คือคำถามที่จะมีคนถามจริง
    const row = await dbRow<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM audit_log WHERE action = 'master_data.faculty_updated' ORDER BY audit_id DESC LIMIT 1`
    );
    expect(row!.detail.previous).toBe('คณะวิทยาศาสตร์');
  });

  test('ลบสาขาที่มีคนสังกัดไม่ได้ — และข้อความต้องบอกว่าติดอะไรกี่รายการ', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    // นักศึกษา: seed ผูก student2 ไว้กับสาขาแรกอยู่แล้ว
    const usedByStudent = await dbValue<number>(
      `SELECT major_id FROM students GROUP BY major_id ORDER BY COUNT(*) DESC LIMIT 1`
    );
    const students = await request.delete(`${API_URL}/master-data/majors/${usedByStudent}`);
    expect(students.status()).toBe(409);
    expect(await students.text()).toContain('นักศึกษา');

    /**
     * ⛔ `personnel.major_id` กันการลบเหมือนกัน — เคสนี้คือตัวที่จับได้ว่า
     *    ถ้าเช็คแต่ `students` ผู้ใช้จะได้ 500 จาก FK error แทนข้อความที่บอกว่าติดอะไร
     */
    const usedByPersonnel = await dbValue<number>(
      `SELECT p.major_id FROM personnel p
        WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.major_id = p.major_id)
        LIMIT 1`
    );
    if (usedByPersonnel !== undefined) {
      const personnel = await request.delete(`${API_URL}/master-data/majors/${usedByPersonnel}`);
      expect(personnel.status(), await personnel.text()).toBe(409);
      expect(await personnel.text()).toContain('บุคลากร');
    }

    // สาขาที่ไม่มีใครอ้างอยู่ ลบได้จริง
    const free = await dbValue<number>(
      `SELECT m.major_id FROM master_major m
        WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.major_id = m.major_id)
          AND NOT EXISTS (SELECT 1 FROM personnel p WHERE p.major_id = m.major_id)
          AND NOT EXISTS (SELECT 1 FROM job_post_majors j WHERE j.major_id = m.major_id)
        LIMIT 1`
    );
    const ok = await request.delete(`${API_URL}/master-data/majors/${free}`);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await dbValue<string>('SELECT COUNT(*) FROM master_major WHERE major_id = $1', [free])).toBe(
      '0'
    );
  });

  test('ลบคณะต้องบอกว่าจะพาสาขาไหนหายไปบ้าง และคณะที่ยังมีคนสังกัดลบไม่ได้', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    /**
     * ⛔ นี่คือกรณีที่ฐานข้อมูลจะทำผิดให้เองถ้าไม่กัน — `master_major.faculty_id`
     *    เป็น `ON DELETE CASCADE` การลบคณะจึงลบสาขาใต้คณะทิ้งเงียบ ๆ
     */
    const facultyWithStudents = await dbValue<number>(
      `SELECT m.faculty_id FROM master_major m
        JOIN students s ON s.major_id = m.major_id LIMIT 1`
    );
    const blocked = await request.delete(`${API_URL}/master-data/faculties/${facultyWithStudents}`);
    expect(blocked.status(), await blocked.text()).toBe(409);
    expect(await blocked.text()).toContain('นักศึกษา');
    // และต้องไม่มีสาขาไหนหายไประหว่างนั้น
    expect(
      Number(
        await dbValue<string>('SELECT COUNT(*) FROM master_major WHERE faculty_id = $1', [
          facultyWithStudents,
        ])
      )
    ).toBeGreaterThan(0);

    // คณะใหม่ที่มีสาขาแต่ยังไม่มีใครสังกัด — ลบได้ และต้องรายงานว่าลบสาขาอะไรไปด้วย
    const created = await request.post(`${API_URL}/master-data/faculties`, {
      data: { faculty_name_th: 'คณะทดสอบสำหรับลบ' },
    });
    const facultyId = (await created.json()).faculty_id;
    await request.post(`${API_URL}/master-data/majors`, {
      data: { faculty_id: facultyId, major_code: 'TST01', major_name_th: 'สาขาทดสอบหนึ่ง' },
    });
    await request.post(`${API_URL}/master-data/majors`, {
      data: { faculty_id: facultyId, major_code: 'TST02', major_name_th: 'สาขาทดสอบสอง' },
    });

    const removed = await request.delete(`${API_URL}/master-data/faculties/${facultyId}`);
    expect(removed.status(), await removed.text()).toBe(200);
    const body = await removed.json();
    expect(body.deleted_majors).toHaveLength(2);
    expect(body.deleted_majors.map((m: any) => m.major_code).sort()).toEqual(['TST01', 'TST02']);
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM master_major WHERE faculty_id = $1', [facultyId])
    ).toBe('0');
  });

  test('GET /master-data มีตัวนับใหม่ โดยไม่ทำคีย์เดิมของ dropdown หาย', async ({ request }) => {
    const before = await (await request.get(`${API_URL}/master-data`)).json();

    // ⛔ คีย์เดิมทุกตัวต้องอยู่ครบ — ทุกหน้าจอในระบบเติม dropdown จากเส้นนี้
    for (const key of ['faculties', 'majors', 'provinces', 'semesters', 'googleMapsApiKey']) {
      expect(before, `คีย์ ${key} หายไป = dropdown ทั้งระบบพัง`).toHaveProperty(key);
    }
    const major = before.majors[0];
    for (const key of ['major_id', 'faculty_id', 'faculty_name_th', 'major_code', 'major_name_th']) {
      expect(major).toHaveProperty(key);
    }

    // คีย์ใหม่ต้องเป็นตัวเลขที่ตรงกับของจริง ไม่ใช่ 0 ลอย ๆ
    const usedMajorId = await dbValue<number>(
      'SELECT major_id FROM students GROUP BY major_id ORDER BY COUNT(*) DESC LIMIT 1'
    );
    const realCount = Number(
      await dbValue<string>('SELECT COUNT(*) FROM students WHERE major_id = $1', [usedMajorId])
    );
    expect(before.majors.find((m: any) => m.major_id === usedMajorId).student_count).toBe(realCount);

    const faculty = before.faculties[0];
    expect(faculty).toHaveProperty('major_count');
    expect(faculty).toHaveProperty('student_count');

    // เพิ่มนักศึกษาหนึ่งคนแล้วตัวนับต้องขยับ — พิสูจน์ว่านับสด ไม่ใช่ค่าคงที่
    await dbExec(
      `INSERT INTO users (email, password_hash) VALUES ('countcheck@test.com', 'x')
       ON CONFLICT (email) DO NOTHING`
    );
    await dbExec(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year)
       SELECT user_id, '65888888', $1, 3.00, 2569 FROM users WHERE email = 'countcheck@test.com'
       ON CONFLICT (student_id) DO NOTHING`,
      [usedMajorId]
    );
    const after = await (await request.get(`${API_URL}/master-data`)).json();
    expect(after.majors.find((m: any) => m.major_id === usedMajorId).student_count).toBe(
      realCount + 1
    );
  });
});
