/**
 * แก้ข้อมูลสถานประกอบการจากฟอร์ม สหกิจ 07 (หน้า 1–2)
 *
 * ย้ายมาจาก `controllers/form07.ts` ตอนลบบทบาท `company` ออกจากระบบ — ผู้ใช้ที่เหลือคือ
 * `acceptance.ts approveByOfficer` (เจ้าหน้าที่กดรับ → เขียนข้อมูลที่บริษัทกรอกผ่านลิงก์
 * ตอบรับลง `companies`) และ `publicAcceptance.ts` (ตรวจช่องก่อนพักข้อมูล)
 */

type Client = { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> };

/**
 * ฟิลด์ที่บริษัทแก้ได้ผ่าน **สหกิจ 07 เท่านั้น**
 *
 * ต่างจาก allow-list ของ สหกิจ 02 ตรงที่มีที่อยู่รวมอยู่ด้วย — เพราะกระดาษ 07
 * สั่งตรง ๆ ว่า "โปรดระบุที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงาน" ซึ่งเป็นข้อมูลที่
 * มีแต่บริษัทเท่านั้นที่รู้ และอาจารย์นิเทศใช้เดินทางจริง
 *
 * ⛔ ยังห้ามแก้ `name_th` `name_en` และ `is_verified` — ชื่อทางการเป็นของทะเบียนที่
 *    เจ้าหน้าที่รับรอง และถูกพิมพ์ลงใบรับรองภาษาอังกฤษของนักศึกษา
 */
export const FORM07_WRITABLE_FIELDS = [
  'house_no', 'road', 'soi', 'subdistrict', 'district', 'province', 'postal_code',
  'phone', 'fax', 'email',
  'manager_name', 'manager_position', 'manager_department', 'manager_phone',
  'manager_fax', 'manager_email',
  'contact_mode', 'contact_person', 'contact_position', 'contact_department',
  'contact_phone', 'contact_fax',
] as const;

export async function updateCompanyFields(client: Client, companyId: number, input: Record<string, unknown>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of FORM07_WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      values.push(input[field] === '' ? null : input[field]);
      sets.push(`${field} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;

  values.push(companyId);
  await client.query(
    `UPDATE companies SET ${sets.join(', ')} WHERE company_id = $${values.length}`,
    values
  );

  // ประกอบ `address` ใหม่จากช่องย่อย เพื่อให้หนังสือราชการที่วาดจากคอลัมน์เดิม
  // ยังได้ที่อยู่ล่าสุดโดยไม่ต้องแก้ตัวสร้างเอกสารสักตัว
  // ⛔ ทำเฉพาะเมื่อมีช่องย่อยอย่างน้อยหนึ่งช่อง — ไม่งั้นบริษัทที่ยังไม่เคยกรอกช่องย่อย
  //    จะถูกล้างที่อยู่เดิมที่เจ้าหน้าที่คีย์ไว้ทิ้งไปเฉย ๆ
  const touchesAddress = ['house_no', 'road', 'soi', 'subdistrict'].some((f) =>
    Object.prototype.hasOwnProperty.call(input, f)
  );
  if (touchesAddress) {
    await client.query(
      `UPDATE companies
          SET address = btrim(regexp_replace(
                concat_ws(' ',
                  NULLIF(btrim(coalesce(house_no, '')), ''),
                  -- รูปแบบเดียวกับที่อยู่ที่เจ้าหน้าที่คีย์ไว้เดิม
                  -- ("90 หมู่ 15 ถนนมิตรภาพ ตำบลสูงเนิน") เพื่อให้หนังสือราชการ
                  -- ที่พิมพ์จากคอลัมน์นี้หน้าตาไม่เปลี่ยนไปจากของเดิม
                  CASE WHEN NULLIF(btrim(coalesce(soi, '')), '') IS NOT NULL
                       THEN 'ซอย ' || soi END,
                  CASE WHEN NULLIF(btrim(coalesce(road, '')), '') IS NOT NULL
                       THEN 'ถนน' || road END,
                  CASE WHEN NULLIF(btrim(coalesce(subdistrict, '')), '') IS NOT NULL
                       THEN 'ตำบล' || subdistrict END
                ), '\\s+', ' ', 'g'))
        WHERE company_id = $1
          AND concat_ws('', house_no, soi, road, subdistrict) <> ''`,
      [companyId]
    );
  }
}
