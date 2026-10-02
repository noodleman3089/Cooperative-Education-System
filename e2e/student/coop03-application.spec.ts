import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { decryptSensitive } from '../../backend/src/utils/encryption';

/**
 * สหกิจ 03 · ก้อน 4b — ใบสมัครงานสหกิจศึกษา (ส่วนตัวตน/ติดต่อ/ฉุกเฉิน/อ่อนไหว)
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **เลขบัตรลงฐานเป็น ciphertext จริง ไม่ใช่ข้อความเปล่า** และถอดกลับได้ค่าเดิม
 *   2. **ค่าจริงไม่เคยออกจาก endpoint** — ตอบกลับมีแต่มาสก์กับธง
 *   3. **PDPA ม.26** — เชื้อชาติ/ศาสนาเขียนไม่ได้ถ้ายังไม่ยินยอมโดยชัดแจ้ง
 *   4. **เว้นช่องอ่อนไหวไว้ว่าง = ไม่แก้ ไม่ใช่ลบทิ้ง** (หน้าจอเห็นแต่มาสก์)
 *   5. **ผู้ติดต่อฉุกเฉินเป็นแหล่งเดียวร่วมกับ สหกิจ 06** ไม่ใช่ข้อมูลสองชุด
 */

const ID_13 = '1234567890123';

const readBack = (request: APIRequestContext) =>
  request.get(`${API_URL}/students/coop-application`).then((r) => r.json());

const save = (request: APIRequestContext, body: Record<string, unknown>) =>
  request.put(`${API_URL}/students/coop-application`, { data: body });

const studentId = () =>
  dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");

test.describe('สหกิจ 03 — ใบสมัครงาน (ตัวตน/ติดต่อ/ฉุกเฉิน/อ่อนไหว)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec(
      `UPDATE students SET national_id_ciphertext = NULL, national_id_iv = NULL,
              national_id_tag = NULL, ethnicity_ciphertext = NULL, ethnicity_iv = NULL,
              ethnicity_tag = NULL, religion_ciphertext = NULL, religion_iv = NULL,
              religion_tag = NULL, sensitive_data_consented_at = NULL,
              first_name_en = NULL, emergency_contact_name = NULL`
    );
  });

  test('C1: บันทึกช่องทั่วไป → ลงฐานตรงตัว และอ่านกลับได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, {
      first_name_en: 'Somchai',
      last_name_en: 'Saidee',
      gender: 'ชาย',
      nationality: 'ไทย',
      mobile_phone: '0891234567',
      fax: '038-123457',
      emergency_contact_name: 'นางสมศรี ใจดี',
      emergency_relationship: 'มารดา',
      emergency_phone: '0898765432',
      emergency_address: '99/9 ถนนทดสอบ',
    });
    expect(res.status(), await res.text()).toBe(200);

    const back = await readBack(request);
    expect(back.first_name_en).toBe('Somchai');
    expect(back.gender).toBe('ชาย');
    expect(back.mobile_phone).toBe('0891234567');
    expect(back.emergency_contact_name).toBe('นางสมศรี ใจดี');
  });

  test('C2: เลขบัตรลงฐานเป็น ciphertext จริง ถอดกลับได้ และ endpoint คืนแค่มาสก์', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    expect((await save(request, { national_id: ID_13 })).status()).toBe(200);

    const row = await dbRow<{
      national_id_ciphertext: string;
      national_id_iv: string;
      national_id_tag: string;
    }>(
      `SELECT national_id_ciphertext, national_id_iv, national_id_tag
         FROM students WHERE student_id = $1`,
      [await studentId()]
    );

    // ⛔ ตัวกันไม่ให้ใครเผลอเก็บเลขบัตรเป็นข้อความเปล่าแล้วเรียกว่า "เข้ารหัสแล้ว"
    expect(row?.national_id_ciphertext).toBeTruthy();
    expect(row?.national_id_ciphertext).not.toContain(ID_13);
    expect(
      decryptSensitive({
        ciphertext: row!.national_id_ciphertext,
        iv: row!.national_id_iv,
        authTag: row!.national_id_tag,
      })
    ).toBe(ID_13);

    // ค่าจริงต้องไม่โผล่ใน response ไม่ว่าคีย์ไหน
    const back = await readBack(request);
    expect(JSON.stringify(back)).not.toContain(ID_13);
    expect(back.national_id_masked).toBe('x-xxxx-xxxxx-xx-3');
  });

  test('C3: เลขบัตรไม่ครบ 13 หลัก → 400 และฐานต้องไม่ขยับ', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, { national_id: '12345' });
    expect(res.status()).toBe(400);
    expect((await res.json()).message as string).toContain('13 หลัก');
    expect(
      await dbValue<string | null>(
        'SELECT national_id_ciphertext FROM students WHERE student_id = $1',
        [await studentId()]
      )
    ).toBeNull();
  });

  test('C4: PDPA ม.26 — ส่งเชื้อชาติ/ศาสนาโดยยังไม่ยินยอม → 400 ไม่เขียนเงียบๆ', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, { ethnicity: 'ไทย', religion: 'พุทธ' });
    expect(res.status()).toBe(400);
    expect((await res.json()).message as string).toContain('มาตรา 26');

    expect(
      await dbValue<string | null>(
        'SELECT ethnicity_ciphertext FROM students WHERE student_id = $1',
        [await studentId()]
      )
    ).toBeNull();
  });

  test('C5: ยินยอมแล้ว → เขียนได้ · เข้ารหัสจริง · ลง audit_log · ครั้งต่อไปไม่ต้องยินยอมซ้ำ', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const ok = await save(request, {
      ethnicity: 'ไทย',
      religion: 'พุทธ',
      sensitive_data_consent: true,
    });
    expect(ok.status(), await ok.text()).toBe(200);

    const row = await dbRow<{
      ethnicity_ciphertext: string;
      ethnicity_iv: string;
      ethnicity_tag: string;
      sensitive_data_consented_at: string | null;
    }>(
      `SELECT ethnicity_ciphertext, ethnicity_iv, ethnicity_tag, sensitive_data_consented_at
         FROM students WHERE student_id = $1`,
      [await studentId()]
    );
    expect(row?.sensitive_data_consented_at).not.toBeNull();
    expect(
      decryptSensitive({
        ciphertext: row!.ethnicity_ciphertext,
        iv: row!.ethnicity_iv,
        authTag: row!.ethnicity_tag,
      })
    ).toBe('ไทย');

    // เวลาที่ยินยอมต้องตามย้อนได้ ไม่ใช่มีแต่คอลัมน์ที่แก้ทับได้ (SEC-07)
    // ⚠️ `writeAudit` เป็น fire-and-forget — ลงหลัง response จึงต้อง poll
    const sid = String(await studentId());
    await expect
      .poll(() =>
        dbValue<string>(
          `SELECT COUNT(*) FROM audit_log
            WHERE action = 'student.sensitive_data_consent_given' AND entity_id = $1`,
          [sid]
        )
      )
      .toBe('1');

    // ยินยอมแล้วครั้งเดียวพอ — ส่งอีกรอบโดยไม่ติ๊กต้องผ่าน
    expect((await save(request, { religion: 'คริสต์' })).status()).toBe(200);

    const back = await readBack(request);
    expect(back.has_ethnicity).toBe(true);
    expect(back.has_religion).toBe(true);
    // ⛔ ธงเท่านั้น ห้ามส่งค่าจริงกลับ
    expect(JSON.stringify(back)).not.toContain('พุทธ');
    expect(JSON.stringify(back)).not.toContain('คริสต์');
  });

  test('C6: เว้นช่องอ่อนไหวไว้ว่างแล้วบันทึก → ค่าเดิมต้องไม่หาย', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    expect((await save(request, { national_id: ID_13 })).status()).toBe(200);

    // ⛔ หน้าจอเห็นแต่มาสก์ ถ้าเขียนทับตรงๆ การกดบันทึกโดยไม่แตะช่องนั้น
    //    จะลบเลขบัตรทิ้งเงียบๆ — โมเดลจึงใช้ COALESCE
    expect((await save(request, { first_name_en: 'Changed' })).status()).toBe(200);

    const back = await readBack(request);
    expect(back.national_id_masked).toBe('x-xxxx-xxxxx-xx-3');
    expect(back.first_name_en).toBe('Changed');
  });

  test('C7: สิทธิ์ — บทบาทอื่นเข้าไม่ได้ และไม่มี :id ให้ยิงของคนอื่น', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/students/coop-application`)).status()).toBe(403);
    expect((await save(request, { first_name_en: 'X' })).status()).toBe(403);

    await apiLoginAs(request, 'mentor1');
    expect((await request.get(`${API_URL}/students/coop-application`)).status()).toBe(403);
  });

  test('C8: ผู้ติดต่อฉุกเฉินเป็นแหล่งเดียวกับ สหกิจ 06 — กรอกที่นี่แล้วอีกใบเห็นตาม', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    expect(
      (
        await save(request, {
          emergency_contact_name: 'นายฉุกเฉิน ทดสอบ',
          emergency_relationship: 'บิดา',
          emergency_phone: '0811112222',
        })
      ).status()
    ).toBe(200);

    // แถวที่พักต้องมีอยู่ก่อน endpoint ของ สหกิจ 06 ถึงจะคืนบล็อกนี้มา
    await dbExec(
      `INSERT INTO accommodations (student_id, house_no, subdistrict, district, province, postal_code)
       VALUES ($1, '1/1', 'บางพระ', 'ศรีราชา', 'ชลบุรี', '20110')
       ON CONFLICT (student_id) DO NOTHING`,
      [await studentId()]
    );

    const acc = await request
      .get(`${API_URL}/students/${await studentId()}/accommodation-plan`)
      .then((r) => r.json());
    expect(acc.accommodation.emergency_contact).toBe('นายฉุกเฉิน ทดสอบ');
    expect(acc.accommodation.emergency_phone).toBe('0811112222');
  });

  test('C11: ประวัติ 4 ก้อนลงฐานเป็น JSONB จริง และอ่านกลับได้ครบ', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, {
      career_objective: 'อยากเป็นนักพัฒนาระบบ',
      family_info: {
        father: { name: 'นายพ่อ ใจดี', age: '55', occupation: 'รับราชการ', phone: '0811111111' },
        mother: { name: 'นางแม่ ใจดี', age: '52', occupation: 'ค้าขาย', phone: '0822222222' },
        sibling_count: '2',
        birth_order: '1',
        siblings: [{ name: 'น้องสาว ใจดี', occupation: 'นักเรียน' }],
      },
      education_history: [
        { level: 'มัธยมปลาย', institution: 'โรงเรียนทดสอบ', start_year: '2562', end_year: '2565', degree: 'ม.6', major: 'วิทย์-คณิต' },
      ],
      training_history: [{ period: '2568', institution: 'ศูนย์อบรม', topic: 'ความปลอดภัยไซเบอร์' }],
      activity_history: [{ period: '2567', position: 'ประธานชมรม', duty: 'จัดกิจกรรมนักศึกษา' }],
    });
    expect(res.status(), await res.text()).toBe(200);

    const back = await readBack(request);
    expect(back.career_objective).toBe('อยากเป็นนักพัฒนาระบบ');
    expect(back.family_info.father.name).toBe('นายพ่อ ใจดี');
    expect(back.family_info.siblings).toHaveLength(1);
    expect(back.education_history[0].institution).toBe('โรงเรียนทดสอบ');
    expect(back.training_history[0].topic).toBe('ความปลอดภัยไซเบอร์');
    expect(back.activity_history[0].position).toBe('ประธานชมรม');
  });

  test('C12: คีย์แปลกปลอมถูกตัดทิ้ง · แถวว่างไม่ถูกเก็บ · ไม่ปฏิเสธทั้งคำขอ', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, {
      education_history: [
        // คีย์ที่ไม่อยู่ใน allow-list ต้องถูก "ตัดทิ้ง" ไม่ใช่ทำให้บันทึกไม่ได้ —
        // หน้าจอเวอร์ชันใหม่กว่าส่งคีย์เกินมาไม่ควรทำให้ผู้ใช้ทำงานไม่ได้
        { institution: 'โรงเรียนดี', evil_key: 'DROP TABLE students' },
        {}, // แถวว่างล้วน ต้องไม่ถูกเก็บ
      ],
    });
    expect(res.status(), await res.text()).toBe(200);

    const back = await readBack(request);
    expect(back.education_history).toHaveLength(1);
    expect(back.education_history[0].institution).toBe('โรงเรียนดี');
    expect(back.education_history[0].evil_key).toBeUndefined();
  });

  test('C13: ไม่ส่งประวัติมาเลย → ค่าเดิมต้องไม่หาย (ไม่ได้แก้ ≠ ล้างทิ้ง)', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    expect(
      (await save(request, { training_history: [{ period: '2568', topic: 'อบรม ก' }] })).status()
    ).toBe(200);

    // บันทึกรอบถัดไปโดยไม่แตะประวัติเลย
    expect((await save(request, { first_name_en: 'Somchai' })).status()).toBe(200);

    const back = await readBack(request);
    expect(back.training_history).toHaveLength(1);
    expect(back.training_history[0].topic).toBe('อบรม ก');
  });

  test('C16: หน้าจอ — เพิ่ม/ลบแถวประวัติแล้วบันทึกได้จริง', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    await page.getByTestId('ca-education-add').click();
    await page.getByTestId('ca-education-0-institution').fill('โรงเรียนทดสอบ');
    await page.getByTestId('ca-education-0-degree').fill('ม.6');

    await page.getByTestId('ca-education-add').click();
    await expect(page.getByTestId('ca-education-row')).toHaveCount(2);
    await page.getByTestId('ca-education-1-remove').click();
    await expect(page.getByTestId('ca-education-row')).toHaveCount(1);

    await page.getByTestId('ca-father-name').fill('นายพ่อ ใจดี');
    await page.getByTestId('ca-career').fill('อยากเป็นนักพัฒนาระบบ');
    await page.getByTestId('ca-submit').click();
    await expect(page.getByText(/บันทึกข้อมูลใบสมัครงานสหกิจศึกษาเรียบร้อยแล้ว/)).toBeVisible();

    await page.reload();
    await goToMenu(page, 'job_application');
    await expect(page.getByTestId('ca-education-0-institution')).toHaveValue('โรงเรียนทดสอบ');
    await expect(page.getByTestId('ca-father-name')).toHaveValue('นายพ่อ ใจดี');
  });

  test('C9: หน้าจอ — กรอก บันทึก แล้วค่ายังอยู่หลังโหลดใหม่ · มาสก์ไม่ใช่เลขจริง', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    await page.getByTestId('ca-first-en').fill('Somchai');
    await page.getByTestId('ca-mobile').fill('0891234567');
    await page.getByTestId('ca-emg-name').fill('นางสมศรี ใจดี');
    await page.getByTestId('ca-national-id').fill(ID_13);
    await page.getByTestId('ca-submit').click();

    await expect(page.getByText(/บันทึกข้อมูลใบสมัครงานสหกิจศึกษาเรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('ca-national-id-masked')).toContainText('x-xxxx-xxxxx-xx-3');

    // ⛔ เลขจริงต้องไม่อยู่บนหน้าจอเลยหลังบันทึก
    await expect(page.locator('body')).not.toContainText(ID_13);

    // เมนูอยู่ใน React state ไม่ใช่ URL — รีโหลดแล้วต้องเข้าเมนูใหม่
    await page.reload();
    await goToMenu(page, 'job_application');
    await expect(page.getByTestId('ca-first-en')).toHaveValue('Somchai');
    await expect(page.getByTestId('ca-emg-name')).toHaveValue('นางสมศรี ใจดี');
  });

  test('C10: หน้าจอ — ปุ่มบันทึกกดไม่ได้ถ้ากรอกเชื้อชาติ/ศาสนาโดยยังไม่ติ๊กยินยอม', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    await expect(page.getByTestId('ca-submit')).toBeEnabled();

    await page.getByTestId('ca-ethnicity').fill('ไทย');
    await expect(page.getByTestId('ca-submit')).toBeDisabled();

    await page.getByTestId('ca-consent').check();
    await expect(page.getByTestId('ca-submit')).toBeEnabled();

    await page.getByTestId('ca-submit').click();
    await expect(page.getByText(/บันทึกข้อมูลใบสมัครงานสหกิจศึกษาเรียบร้อยแล้ว/)).toBeVisible();
    // ยินยอมแล้ว checkbox หายไป เหลือข้อความยืนยันวันที่แทน
    await expect(page.getByTestId('ca-consent-done')).toBeVisible();
  });
});
