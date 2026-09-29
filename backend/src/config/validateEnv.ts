/**
 * ด่านตรวจค่า env ตอนสตาร์ท — กันการขึ้น production ด้วยค่าของ dev
 *
 * ทุกอย่างที่ตรวจตรงนี้เคยเป็นแค่บรรทัดใน checklist ที่ไม่มีอะไรบังคับ และอันตราย
 * ที่สุดคือ `ALLOW_SIMULATED_SSO`: เปิดไว้เมื่อไหร่ ใครก็ตามที่ส่ง
 * `simulated_token_for_dean@rmutto.ac.th` เข้ามาจะกลายเป็นคณบดีทันที โดยไม่ต้องมี
 * บัญชี Google และไม่ต้องรู้รหัสผ่านอะไรเลย — เป็นค่าที่ dev ต้องเปิด และ production
 * ต้องไม่มีวันเปิด จึงไม่ควรฝากไว้กับความจำของคน
 *
 * แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสต์เรียกได้โดยไม่ต้องสตาร์ทเซิร์ฟเวอร์จริง
 */

export interface EnvCheckResult {
  /** ปัญหาที่ห้ามสตาร์ท — คนภายนอกใช้ประโยชน์ได้ทันที */
  errors: string[];
  /** ปัญหาที่ระบบยังทำงานได้ แต่ทำงานผิดจากที่ตั้งใจ */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

export function checkEnvironment(env: Env = process.env): EnvCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = env.NODE_ENV === 'production';

  if (!env.JWT_SECRET) {
    errors.push('JWT_SECRET ไม่ได้ตั้งค่า');
  } else if (isProduction && env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET สั้นเกินไปสำหรับ production (ต้องอย่างน้อย 32 ตัวอักษร)');
  }

  if (isProduction) {
    if (env.ALLOW_SIMULATED_SSO === 'true') {
      errors.push(
        'ALLOW_SIMULATED_SSO=true บน production — เปิดไว้แปลว่าใครก็ล็อกอินเป็นใครก็ได้ ' +
          'โดยไม่ต้องมีบัญชี Google'
      );
    }

    if (env.ENABLE_TEST_ROUTES === 'true') {
      errors.push('ENABLE_TEST_ROUTES=true บน production — เส้นทางสำหรับทดสอบต้องปิด');
    }

    // MAIL_DRY_RUN ทำให้ระบบ "ไม่ส่งอีเมลจริง" แต่ยังตอบนักศึกษาว่าส่งแล้ว — บน production
    // แปลว่าหนังสือที่คณบดีลงนามไม่เคยถึงสถานประกอบการเลยโดยไม่มีใครรู้
    if (env.MAIL_DRY_RUN === 'true') {
      errors.push(
        'MAIL_DRY_RUN=true บน production — ระบบจะไม่ส่งอีเมลจริงแต่ตอบผู้ใช้ว่าส่งสำเร็จ ต้องปิด'
      );
    }

    // SEC-08: cookie ถูกตั้ง Secure ตอน production เบราว์เซอร์จึงส่งกลับเฉพาะบน https
    // ถ้า FRONTEND_URL ยังเป็น http จะล็อกอินไม่ได้เลยแบบหาสาเหตุยาก
    if (env.FRONTEND_URL && !env.FRONTEND_URL.startsWith('https://')) {
      warnings.push(
        `FRONTEND_URL ไม่ใช่ https (${env.FRONTEND_URL}) — session cookie ตั้ง Secure ` +
          'ตอน production เบราว์เซอร์จะไม่ส่งกลับ ทำให้ล็อกอินไม่ผ่าน'
      );
    }

    if (!env.TRUST_PROXY) {
      warnings.push(
        'TRUST_PROXY ไม่ได้ตั้งค่า — ถ้ามี reverse proxy อยู่หน้าเซิร์ฟเวอร์ ' +
          'rate limit ต่อ IP จะยุบเหลือถังเดียว และ audit_log.ip_address จะเป็น IP ของ proxy'
      );
    }

    if (!env.SMTP_HOST || !env.SMTP_USER) {
      warnings.push('SMTP ยังไม่ได้ตั้งค่า — ระบบจะส่งอีเมลแจ้งเตือนและลิงก์เชิญไม่ได้');
    }

    if (!env.GOOGLE_CLIENT_ID) {
      warnings.push('GOOGLE_CLIENT_ID ยังไม่ได้ตั้งค่า — นักศึกษาและบุคลากรจะเข้าระบบไม่ได้');
    }

    // SEC-12: เข้ารหัสเลขบัตรประชาชน/เชื้อชาติ/ศาสนาของ สหกิจ 03 — `utils/encryption.ts`
    // ⛔ ยังเป็น**คำเตือน** ไม่ใช่ error เพราะฟีเจอร์ที่เรียกใช้ยังไม่มีในระบบ (รอก้อนหน้าจอ
    // สหกิจ 03) วันที่ฟีเจอร์นั้นขึ้นจริง ให้ยกระดับเป็น error เหมือน JWT_SECRET ด้านบน —
    // ไม่งั้นความล้มเหลวจะไปโผล่ตอนนักศึกษากดส่งฟอร์มแทนที่จะกันไว้ตั้งแต่สตาร์ท
    if (!env.SENSITIVE_DATA_ENCRYPTION_KEY) {
      warnings.push(
        'SENSITIVE_DATA_ENCRYPTION_KEY ยังไม่ได้ตั้งค่า — เมื่อเปิดใช้ สหกิจ 03 ' +
          'การเข้ารหัสเลขบัตรประชาชน/เชื้อชาติ/ศาสนาจะล้มเหลวทุกครั้ง'
      );
    } else if (!/^[0-9a-fA-F]{64}$/.test(env.SENSITIVE_DATA_ENCRYPTION_KEY)) {
      warnings.push(
        'SENSITIVE_DATA_ENCRYPTION_KEY รูปแบบไม่ถูกต้อง ต้องเป็นเลขฐานสิบหก 64 ตัวอักษร ' +
          '(256 บิต) — สร้างด้วย: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }

    // เตือนไม่ใช่ error ต่างจาก ALLOW_SIMULATED_SSO เพราะบางสภาพแวดล้อมจำเป็นต้องใช้จริง
    if (env.PUPPETEER_NO_SANDBOX === 'true') {
      warnings.push(
        'PUPPETEER_NO_SANDBOX=true — Chrome ที่สร้าง PDF จะรันโดยไม่มี sandbox ' +
          'ตั้งค่านี้เฉพาะเมื่อรันใน container ที่เปิด sandbox ไม่ได้จริงๆ'
      );
    }
  } else {
    // เตือนไว้ให้เห็นตอน dev ว่ากำลังรันด้วยค่าที่ห้ามเอาขึ้น production
    if (env.ALLOW_SIMULATED_SSO === 'true') {
      warnings.push('ALLOW_SIMULATED_SSO=true (โหมด dev) — ต้องปิดก่อนขึ้น production');
    }
    if (env.ENABLE_TEST_ROUTES === 'true') {
      warnings.push('ENABLE_TEST_ROUTES=true (โหมด dev) — ต้องปิดก่อนขึ้น production');
    }
    if (env.MAIL_DRY_RUN === 'true') {
      warnings.push('MAIL_DRY_RUN=true (โหมด dev) — ระบบไม่ส่งอีเมลจริง ต้องปิดก่อนขึ้น production');
    }
  }

  return { errors, warnings };
}

/**
 * ตรวจแล้วหยุดโปรเซสถ้าเจอปัญหาที่ห้ามสตาร์ท
 * เรียกครั้งเดียวใน `index.ts` ก่อนสร้าง app
 */
export function assertEnvironment(env: Env = process.env): void {
  const { errors, warnings } = checkEnvironment(env);

  for (const warning of warnings) {
    console.warn(`[env] คำเตือน: ${warning}`);
  }

  if (errors.length > 0) {
    console.error('[env] ค่าคอนฟิกไม่ปลอดภัยสำหรับการรัน เซิร์ฟเวอร์จะไม่สตาร์ท:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}
