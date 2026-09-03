import crypto from 'crypto';

/**
 * SEC-12 — เข้ารหัสสองทาง (encryption at rest) สำหรับข้อมูลอ่อนไหวที่ต้อง**อ่านค่าเดิม
 * กลับมาได้** เช่นเลขบัตรประชาชนที่ต้องพิมพ์ลงใบ สหกิจ 03
 *
 * ⛔ **นี่ไม่ใช่ตัวเดียวกับ hash** — hash (`utils/password.ts`) เป็นทางเดียว เหมาะกับ
 * รหัสผ่าน (เก็บไว้เทียบว่าตรงไหม) เลขบัตรประชาชนอ่านกลับไม่ได้ก็พิมพ์ไม่ได้ จึงต้อง
 * เข้ารหัสแบบถอดได้ · ดูตารางเทียบใน `.system_memory/design_stage3_forms.md` ข้อ 1
 *
 * **AES-256-GCM** — เลือกเพราะมี authentication tag ในตัว (ตรวจได้ว่า ciphertext
 * ถูกแก้ไขระหว่างทางหรือไม่) ต่างจาก AES-CBC ที่ต้อง HMAC แยกเอง
 * ⛔ **ห้ามใช้ `crypto.createCipher` (ตัวเก่า ไม่มี IV — deprecated และไม่ปลอดภัย)**
 * ต้องเป็น `createCipheriv` เท่านั้น
 *
 * กุญแจมาจาก **env ไม่ใช่ในฐาน** — ฐานรั่วอย่างเดียวแล้วอ่านไม่ออก คือเหตุผลทั้งหมด
 * ของการเข้ารหัส · ถ้ากุญแจอยู่ในฐานเดียวกับ ciphertext การเข้ารหัสก็ไร้ความหมาย
 * · production ตั้งใจเก็บกุญแจใน Secret Manager (เจ้าของเคาะไว้ว่าจะใช้ HashiCorp Vault
 * ถ้ามหาวิทยาลัยสนใจขึ้นจริง) — โค้ดอ่านจาก `process.env.SENSITIVE_DATA_ENCRYPTION_KEY`
 * **ที่จุดเดียวในไฟล์นี้** วันที่ย้ายไป Vault จึงแก้ที่เดียวพอ ไม่ต้องไล่ทั้งโค้ดเบส
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 บิต — ค่ามาตรฐานของ GCM ไม่ใช่ 16 แบบ CBC
const KEY_LENGTH = 32; // 256 บิต

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/**
 * อ่านกุญแจจาก env — เรียกทุกครั้งที่เข้ารหัส/ถอดรหัส
 *
 * ⛔ **ไม่ cache โดยตั้งใจ** — hex decode 64 ตัวอักษรเบาจนวัดผลต่างไม่ได้ ในขณะที่
 * การ cache สร้างช่องให้ทดสอบยากขึ้น (ค่าที่ถูก cache ไว้จะไม่ตามการเปลี่ยน env
 * ระหว่างเทสต์) — ของถูกไม่คุ้มเสีย
 *
 * ต้องเป็น hex 64 ตัวอักษร (= 32 ไบต์พอดี) ไม่ใช่สตริงข้อความยาว 32 ตัว เพราะสตริง
 * UTF-8 หนึ่งตัวอักษรไม่เท่ากับหนึ่งไบต์เสมอไป (ตัวอักษรไทยกินหลายไบต์) ผลคือกุญแจ
 * สั้นกว่าที่ตั้งใจแบบเงียบๆ · สร้างด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
 */
function getKey(): Buffer {
  const hex = process.env.SENSITIVE_DATA_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'SENSITIVE_DATA_ENCRYPTION_KEY ไม่ได้ตั้งค่า — ต้องมีก่อนเข้ารหัส/ถอดรหัสข้อมูลอ่อนไหว'
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'SENSITIVE_DATA_ENCRYPTION_KEY ต้องเป็นเลขฐานสิบหก 64 ตัวอักษร (256 บิต) — ' +
        `สร้างด้วย: node -e "console.log(require('crypto').randomBytes(${KEY_LENGTH}).toString('hex'))"`
    );
  }

  return Buffer.from(hex, 'hex');
}

/** เข้ารหัสข้อความธรรมดา — คืน ciphertext + iv + authTag แยกกัน เก็บลงฐานทั้งสามค่า */
export function encryptSensitive(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * ถอดรหัสกลับเป็นข้อความธรรมดา
 * throw เมื่อกุญแจผิดหรือ ciphertext ถูกแก้ไข (GCM ตรวจให้อัตโนมัติผ่าน authTag)
 * — ผู้เรียกต้องจัดการ error เอง ไม่ silently คืนสตริงว่างหรือขยะ
 */
export function decryptSensitive(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * มาสก์เลขบัตรประชาชนสำหรับแสดงผลบนหน้าจอ — **ถอดรหัสเฉพาะตอนวาดเอกสารจริง
 * (สหกิจ 03) เท่านั้น** ทุกหน้าจออื่นเห็นแค่มาสก์นี้
 *
 * รูปแบบ `x-xxxx-xxxxx-xx-3` ตามที่เคาะไว้ — เห็นแค่หลักสุดท้าย (หลักตรวจสอบ)
 * ซึ่งไม่พอจะระบุตัวบุคคลได้ แต่ช่วยให้เจ้าหน้าที่เห็นว่ามีเลขอยู่และเดายาวถูก
 */
export function maskNationalId(plainId: string): string {
  const digits = plainId.replace(/\D/g, '');
  if (digits.length !== 13) return 'x-xxxx-xxxxx-xx-x';
  return `x-xxxx-xxxxx-xx-${digits[12]}`;
}
