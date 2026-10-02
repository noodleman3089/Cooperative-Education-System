import { Request, Response, NextFunction } from 'express';
import { StudentModel } from '../models/student';
import { sendUnexpectedError } from '../utils/httpError';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Strips out malicious spreadsheet formulas (e.g. starting with '=', '+', '-', '@')
 * from a cell value to prevent CSV injection.
 */
export const sanitizeCsvCell = (value: string): string => {
  let cleaned = value.trim();
  while (
    cleaned.startsWith('=') ||
    cleaned.startsWith('+') ||
    cleaned.startsWith('-') ||
    cleaned.startsWith('@') ||
    cleaned.startsWith('\t') ||
    cleaned.startsWith('\r')
  ) {
    cleaned = cleaned.substring(1).trim();
  }
  return cleaned;
};

/**
 * Escapes HTML characters in a string.
 *
 * Use this at the point a value is written INTO an HTML document (emails, PDF
 * templates, HTML responses) — never on the way in. Escaping on input corrupts
 * the stored data: `O'Brien` became `O&#x27;Brien` in the database and was
 * re-escaped on every edit, and passwords were mangled before hashing.
 * Browsers render escaped text correctly only where HTML is actually built;
 * React and Handlebars `{{ }}` already escape on their own.
 */
export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

/**
 * Recursively trims strings in an object. Values are stored verbatim — see
 * `escapeHtml` above for why encoding no longer happens here.
 */
export const sanitizeObject = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'string') {
    return obj.trim() as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as T;
  }
  if (typeof obj === 'object') {
    const source = obj as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      sanitized[key] = sanitizeObject(source[key]);
    }
    return sanitized as T;
  }
  return obj;
};

/**
 * Express middleware that trims incoming strings. XSS is handled where HTML is
 * produced (see `escapeHtml`), not here.
 */
export const xssSanitizer = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  next();
};

/**
 * Validates Login input.
 */
export const validateLogin = (req: Request, res: Response, next: NextFunction): void => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string') {
    res.status(400).json({ message: 'กรุณากรอกอีเมลหรือรหัสนักศึกษา' });
    return;
  }

  if (!password || typeof password !== 'string') {
    res.status(400).json({ message: 'กรุณากรอกรหัสผ่าน' });
    return;
  }

  const isEmail = EMAIL_REGEX.test(email);
  const isStudentCode = /^s?[\d-]+$/.test(email.trim());

  if (!isEmail && !isStudentCode) {
    res.status(400).json({ message: 'รูปแบบอีเมลหรือรหัสนักศึกษาไม่ถูกต้อง' });
    return;
  }

  next();
};

/**
 * Validates Profile Setup input dynamically based on target type in request body.
 */
export const validateProfileSetup = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized. Authenticated session required.' });
    return;
  }

  const { type } = req.body;

  if (!type || !['student', 'personnel'].includes(type)) {
    res.status(400).json({ message: "type is required and must be either 'student' or 'personnel'." });
    return;
  }

  if (type === 'student') {
    const { student_code, major_id, province_id, cumulative_gpa } = req.body;

    if (!student_code || typeof student_code !== 'string') {
      res.status(400).json({ message: 'student_code must be a non-empty string.' });
      return;
    }

    const cleanStudentCode = student_code.trim();
    if (!/^\d{12}-\d$/.test(cleanStudentCode)) {
      res.status(400).json({ message: 'รูปแบบรหัสนักศึกษาไม่ถูกต้อง ต้องเป็นตัวเลข 12 หลัก ตามด้วยเครื่องหมายขีดกลางและเลข 1 หลัก (เช่น 123456789012-3)' });
      return;
    }

    // Impersonation Prevention check:
    const email = req.user.email;
    if (!email) {
      res.status(400).json({ message: 'User email is missing from session.' });
      return;
    }

    const emailLocalPart = email.split('@')[0].toLowerCase();
    
    // Check if the local part is a student code format (e.g., s12345 or s026600000000-0)
    const isCodeFormat = /^s?[\d-]+$/.test(emailLocalPart);

    if (isCodeFormat) {
      const expectedStudentCode = emailLocalPart.startsWith('s') ? emailLocalPart.substring(1) : emailLocalPart;
      if (cleanStudentCode !== expectedStudentCode) {
        res.status(403).json({
          message: `Forbidden. Student code '${student_code}' does not match authenticated email local prefix.`
        });
        return;
      }
    }

    if (major_id === undefined || typeof major_id !== 'number' || !Number.isInteger(major_id)) {
      res.status(400).json({ message: 'major_id must be a valid integer.' });
      return;
    }

    if (province_id !== undefined && province_id !== null && (typeof province_id !== 'number' || !Number.isInteger(province_id))) {
      res.status(400).json({ message: 'province_id must be a valid integer.' });
      return;
    }

    if (cumulative_gpa !== undefined && cumulative_gpa !== null) {
      if (typeof cumulative_gpa !== 'number' || isNaN(cumulative_gpa)) {
        res.status(400).json({ message: 'cumulative_gpa must be a valid number.' });
        return;
      }
      if (cumulative_gpa < 0 || cumulative_gpa > 4.0) {
        res.status(400).json({ message: 'cumulative_gpa must be between 0.00 and 4.00.' });
        return;
      }
    }
  } else if (type === 'personnel') {
    const { major_id, e_signature_file, role } = req.body;

    if (major_id === undefined || typeof major_id !== 'number' || !Number.isInteger(major_id)) {
      res.status(400).json({ message: 'major_id must be a valid integer.' });
      return;
    }

    if (e_signature_file !== undefined && e_signature_file !== null && typeof e_signature_file !== 'string') {
      res.status(400).json({ message: 'e_signature_file must be a string path.' });
      return;
    }

    if (role !== undefined) {
      if (typeof role !== 'string') {
        res.status(400).json({ message: 'role must be a valid string.' });
        return;
      }
      const VALID_ROLES = ['student', 'advisor', 'dean', 'staff', 'dept_head', 'mentor'];
      if (!VALID_ROLES.includes(role)) {
        res.status(400).json({ message: 'Invalid role value.' });
        return;
      }
    }
  }

  next();
};

/**
 * ต้องมีโปรไฟล์นักศึกษาก่อนยื่นใบความจำนง
 *
 * ⛔ SEC-02 — **ระบบไม่ตรวจสิทธิ์สหกิจของนักศึกษา** (เจ้าของตัดสิน 2026-09-04 · ยืนยัน 2026-09-14
 *    ว่าไม่อยู่ในขอบเขต · migration 031 ลบคอลัมน์ `is_eligible` / `is_orientation_passed` แล้ว)
 *    ใครเหมาะจะออกสหกิจอาจารย์จัดการนอกระบบ · ด่านที่เหลือคือเจ้าหน้าที่รับคำร้องพร้อม
 *    เอกสารหมายเลข 1 ที่ลงนามแล้ว (SEC-04)
 *    · ชื่อเดิม `checkStudentEligibility` — เปลี่ยนเพราะชื่อเดิมสัญญาสิ่งที่มันไม่ได้ทำแล้ว
 *    · จะเพิ่มเกณฑ์ใหม่ (เช่นเกรด) ให้แก้ `security_invariants.md` ข้อ SEC-02 ก่อน
 *      เทสต์ SEC-02 ใน `security-hardening.spec.ts` จะแดงเพื่อเตือน
 */
export const requireStudentProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized. Please log in.' });
      return;
    }

    // Only students submit intents, but let's check for safety
    if (!req.user.roles.includes('student')) {
      res.status(403).json({ message: 'Forbidden. Only students can submit intent forms.' });
      return;
    }

    const student = await StudentModel.findByStudentId(req.user.userId);
    if (!student) {
      res.status(404).json({ message: 'ไม่พบโปรไฟล์นักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อนยื่นคำร้อง' });
      return;
    }

    next();
  } catch (error) {
    sendUnexpectedError(res, error, 'Require Student Profile Error', 'An internal server error occurred while checking the student profile.');
  }
};

