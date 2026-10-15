import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs } from '../helpers/auth';

/**
 * Task 7: Dead Code & Dormant Endpoint Cleanup
 *
 * สิ่งที่ชุดนี้ยืนยัน (Negative & Positive Assertions):
 *   1. Negative Assertion: เส้นทาง `POST /api/users/import` ถูกตัดออกจากระบบอย่างถาวร
 *      เมื่อเจ้าหน้าที่ (staff1) ส่งคำขอ ต้องได้รับ HTTP 404 Not Found เสมอ
 *      (ทดสอบทั้ง JSON payload, raw CSV text, และ empty body)
 *   2. Positive Control: เส้นทางนำเข้าเฉพาะทางที่ยังใช้งานอยู่ต้องยังคงอยู่ และไม่ตอบ 404
 *      - `POST /api/students/import` (นำเข้ารายชื่อนักศึกษา) ตอบ 400 (validation error) ไม่ใช่ 404
 *      - `POST /api/personnel/import` (นำเข้ารายชื่อบุคลากร) ตอบ 400 (validation error) ไม่ใช่ 404
 *   3. Regression Check: เส้นทางจัดการผู้ใช้อื่นๆ ใน `/api/users` ยังทำงานได้ปกติ
 *      - `GET /api/users` ตอบ 200 OK
 *      - `POST /api/users` ยังคงมีอยู่ (ตอบ 400 เมื่อข้อมูลไม่ครบ ไม่ใช่ 404)
 */

test.describe('Task 7: การตัดเส้นทาง POST /api/users/import ออกจากระบบ (Negative Assertions)', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await seedTestData();
  });

  test('U1: POST /api/users/import ต้องตอบ 404 Not Found เมื่อเจ้าหน้าที่ส่งคำขอด้วย JSON payload', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    const response = await request.post(`${API_URL}/users/import`, {
      data: {
        users: [
          { email: 'dormant-test@example.com', role: 'student', student_code: '111111111111-1' }
        ]
      }
    });

    expect(response.status(), `POST ${API_URL}/users/import ยังตอบอยู่ ไม่ใช่ 404`).toBe(404);
  });

  test('U2: POST /api/users/import ต้องตอบ 404 Not Found เมื่อส่งด้วย CSV text payload', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    const csvContent = 'email,role,student_code\ndormant-csv@example.com,student,111111111111-2\n';
    const response = await request.post(`${API_URL}/users/import`, {
      headers: {
        'Content-Type': 'text/csv'
      },
      data: csvContent
    });

    expect(response.status(), `POST ${API_URL}/users/import (CSV) ยังตอบอยู่ ไม่ใช่ 404`).toBe(404);
  });

  test('U3: POST /api/users/import ต้องตอบ 404 Not Found แม้ส่ง body ว่าง', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    const response = await request.post(`${API_URL}/users/import`, {
      data: {}
    });

    expect(response.status(), `POST ${API_URL}/users/import (empty body) ต้องคืน 404`).toBe(404);
  });

  test('U4: เส้นทางนำเข้านักศึกษา POST /api/students/import ต้องยังคงอยู่ (ตอบ 400 ไม่ใช่ 404)', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    // ส่ง body ว่างเพื่อทดสอบว่า router route ยังอยู่และ controller ทำงาน
    // StaffImportController จะคืน 400 พร้อมข้อความแจ้งเตือน (ไม่ใช่ 404)
    const response = await request.post(`${API_URL}/students/import`, {
      data: { csv: '' }
    });

    expect(response.status(), 'POST /api/students/import ต้องไม่ตอบ 404').not.toBe(404);
    expect(response.status(), 'POST /api/students/import ต้องตอบ 400 Bad Request เมื่อไม่มีข้อมูล').toBe(400);
  });

  test('U5: เส้นทางนำเข้าบุคลากร POST /api/personnel/import ต้องยังคงอยู่ (ตอบ 400 ไม่ใช่ 404)', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    // ส่ง body ว่างเพื่อทดสอบว่า router route ยังอยู่และ controller ทำงาน
    // PersonnelImportController จะคืน 400 พร้อมข้อความแจ้งเตือน (ไม่ใช่ 404)
    const response = await request.post(`${API_URL}/personnel/import`, {
      data: { csv: '' }
    });

    expect(response.status(), 'POST /api/personnel/import ต้องไม่ตอบ 404').not.toBe(404);
    expect(response.status(), 'POST /api/personnel/import ต้องตอบ 400 Bad Request เมื่อไม่มีข้อมูล').toBe(400);
  });

  test('U6: เส้นทางจัดการผู้ใช้อื่นๆ ใน /api/users ยังคงทำงานได้ตามปกติ (Regression Check)', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    // 1. GET /api/users ต้องตอบ 200 OK
    const listRes = await request.get(`${API_URL}/users`);
    expect(listRes.status(), 'GET /api/users ต้องตอบ 200 OK').toBe(200);
    const users = await listRes.json();
    expect(Array.isArray(users), 'GET /api/users ต้องคืน array').toBe(true);

    // 2. POST /api/users ยังคงอยู่ (ส่ง body ว่างต้องได้ 400 Bad Request ไม่ใช่ 404)
    const createRes = await request.post(`${API_URL}/users`, {
      data: {}
    });
    expect(createRes.status(), 'POST /api/users ต้องไม่ตอบ 404').toBe(400);
  });
});
