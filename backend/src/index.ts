import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { xssSanitizer } from './middlewares/validation';
import { authenticateToken } from './middlewares/auth';
import apiRouter from './routes';
import { query } from './config/database';
import { assertEnvironment } from './config/validateEnv';
import { initDeactivationScheduler } from './utils/deactivationScheduler';

// Load environment variables
dotenv.config();

// ตรวจค่า env ก่อนทุกอย่าง — รวม JWT_SECRET (CRIT-01) และค่าที่ห้ามติดไปกับ
// production เช่น ALLOW_SIMULATED_SSO ซึ่งเปิดไว้แปลว่าใครก็ล็อกอินเป็นใครก็ได้
assertEnvironment();

const app = express();
const PORT = process.env.PORT || 5000;

// Behind a reverse proxy every request otherwise arrives with the proxy's IP,
// which collapses the per-IP rate limits onto one bucket and makes the audit
// log's ip_address column useless. TRUST_PROXY should name the real topology
// (e.g. "1" for a single nginx hop) rather than blindly trusting every hop.
if (process.env.TRUST_PROXY) {
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? parseInt(trustProxy, 10) : trustProxy);
}

// Security configuration: Helmet (HIGH-02 & Task 3.4)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://accounts.google.com"],
    },
  },
  frameguard: { action: 'sameorigin' },
}));

// CORS Configuration (CRIT-04)
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://coop.rmutto.ac.th'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));

// Rate Limiting (HIGH-01)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV !== 'production' ? 1000 : 10, // Limit each IP to 10 auth requests (1000 in dev)
  message: { message: 'Too many auth requests. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  // นับเฉพาะคำขอที่ล้มเหลว (4xx/5xx) — สิ่งที่ต้องกันคือการเดารหัสผ่าน ไม่ใช่การใช้งานปกติ
  // ⛔ เดิมนับทุกคำขอใต้ /api/auth รวม `GET /auth/me` ที่ยิงทุกครั้งที่โหลดหน้า
  //    โหมด production (10 ครั้ง) = ผู้ใช้จริงรีโหลด 10 หน้าใน 15 นาทีแล้วถูกดีดออก
  //    และชุด E2E ยาว 15 นาทีชนเพดาน dev (1000) ท้ายชุดทุกรอบ (พบ 2026-09-21)
  skipSuccessfulRequests: true,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV !== 'production' ? 10000 : 3000, // 3000/IP — เดิม 100: แดชบอร์ด poll ทุก 10 วิ แท็บเดียว ≈ 90 และมหาวิทยาลัยออกเน็ต IP เดียว (NAT) · เจ้าของตัดสิน 2026-09-21
  message: { message: 'Too many requests. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

app.use(express.json());
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));
app.use(cookieParser());
app.use(xssSanitizer);


// Route: GET /api/files/documents/:doc_id (Retrieve generated cover/transfer letters)
app.get('/api/files/documents/:doc_id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docId = parseInt(req.params.doc_id, 10);
    if (isNaN(docId)) {
      res.status(400).json({ message: 'Invalid document ID.' });
      return;
    }

    const docQuery = await query(
      `SELECT d.generated_file_path, d.student_id, d.status
       FROM official_documents d
       WHERE d.doc_id = $1 LIMIT 1`,
      [docId]
    );

    if ((docQuery.rowCount ?? 0) === 0) {
      res.status(404).json({ message: 'Document not found.' });
      return;
    }

    const doc = docQuery.rows[0];
    const userRoles = req.user?.roles || [];
    const userId = req.user?.userId;

    const isStaff = userRoles.some(r => ['staff', 'dean', 'advisor', 'dept_head'].includes(r));
    const isOwner = userRoles.includes('student') && doc.student_id === userId;

    if (!isStaff && !isOwner) {
      res.status(403).json({ message: 'Forbidden. You do not have access to this document.' });
      return;
    }

    // ⛔ นักศึกษาดาวน์โหลดได้เฉพาะฉบับที่คณบดีลงนามแล้ว
    //
    // หนังสือถูกสร้างตั้งแต่ตอนเจ้าหน้าที่รับคำร้อง (สถานะ pending_sign) เพื่อให้
    // เข้าคิวคณบดี — ฉบับนั้นยังไม่มีลายเซ็น ถ้าปล่อยให้โหลดได้ นักศึกษาอาจเอา
    // หนังสือที่ยังไม่มีผลไปยื่นสถานประกอบการ · เจ้าหน้าที่กับคณบดียังเปิดดูได้
    // เพราะเป็นคนตรวจและลงนามเอง
    if (!isStaff && doc.status !== 'signed') {
      res.status(403).json({
        message: 'หนังสือฉบับนี้ยังรอคณบดีลงนาม จะดาวน์โหลดได้เมื่อลงนามเรียบร้อยแล้ว',
      });
      return;
    }

    const filePath = doc.generated_file_path ? path.join(process.cwd(), doc.generated_file_path) : '';
    if (!filePath || !fs.existsSync(filePath)) {
      const fallbackPath = path.join(process.cwd(), 'secure_private/templates/cover_letter_template.pdf');
      if (fs.existsSync(fallbackPath)) {
        res.sendFile(fallbackPath);
        return;
      }
      res.status(404).json({ message: 'PDF file not found on disk and fallback mock not found.' });
      return;
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

// Protected dynamic file download endpoint supporting both /api/files/ and /api/files/download/ (HIGH-05)
app.get(['/api/files/:category/:filename', '/api/files/download/:category/:filename'], authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, filename } = req.params;
    
    // `final_reports` was missing here, and there is no express.static on
    // /uploads, so a submitted Co-op 14 report could not be opened by anybody —
    // not the advisor who has to grade it, and not the student who uploaded it.
    // Both screens linked straight at http://localhost:5000/uploads/..., which
    // has never resolved to anything.
    const allowedCategories = [
      'resumes',
      'signatures',
      'acceptance_evidence',
      'final_reports',
      // แบบคำร้อง (เอกสารหมายเลข 1) ที่ลงนามแล้ว — เจ้าหน้าที่ต้องเปิดดูก่อนกดผ่าน
      // และนักศึกษาต้องเปิดดูของตัวเองได้ว่าอัปไฟล์ไหนไป
      'request_forms',
      // รูปโปรไฟล์นักศึกษา — เจ้าตัว · บุคลากร · และ**บริษัทที่นักศึกษาสมัครมา**
      // (เปิดให้บริษัทเมื่อ 2026-09-03 พร้อมใบ สหกิจ 03 ซึ่งบนกระดาษมีรูปติดอยู่แล้ว)
      'avatars',
    ];
    if (!allowedCategories.includes(category)) {
      res.status(404).json({ message: 'Category not found.' });
      return;
    }

    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), 'uploads', category, safeName);

    // Authorization runs first, before the file is even looked for. It used to
    // run *after*, with a missing-file fallback in between, so asking for a file
    // that does not exist returned 200 and a blank cover-letter template without
    // any permission check at all. Nothing leaked — the template is empty — but
    // it also made every permission test unreliable, because a request that
    // should have been refused came back with a PDF.
    const userRoles = req.user?.roles || [];
    const userId = req.user?.userId;

    const isStaff = userRoles.some(r => ['staff', 'dean', 'advisor', 'dept_head'].includes(r));
    
    if (!isStaff) {
      let isAuthorizedPartner = false;
      
      // บริษัทเปิดได้สองอย่างของนักศึกษาที่สมัครมาที่ตน: **เรซูเม่** และ **รูปถ่าย**
      // ⛔ รูปถ่ายเพิ่งเปิดเมื่อ 2026-09-03 พร้อมกับใบ สหกิจ 03 (ก้อน 4c) — บนกระดาษ
      //    รูป 1 นิ้วติดอยู่บนใบสมัครที่นักศึกษายื่นให้บริษัทเอง การให้เห็นในระบบจึงไม่ใช่
      //    การเปิดเกินกระดาษ · **ห้ามขยายไปหมวดอื่นโดยไม่ถามว่า "กระดาษใบไหนให้สิ่งนี้"**
      const COMPANY_READABLE: Record<string, RegExp> = {
        resumes: /^resume-user-(\d+)-/,
        avatars: /^avatar-user-(\d+)-/,
      };
      if (userRoles.includes('company') && COMPANY_READABLE[category] && userId !== undefined) {
        const match = safeName.match(COMPANY_READABLE[category]);
        const studentUserId = match ? parseInt(match[1], 10) : null;
        if (studentUserId) {
          const companyQuery = await query('SELECT company_id FROM companies WHERE created_by = $1 LIMIT 1', [userId]);
          if ((companyQuery.rowCount ?? 0) > 0) {
            const companyId = companyQuery.rows[0].company_id;
            const intentCheck = await query(
              `SELECT 1 FROM intent_forms 
               WHERE student_id = $1 AND company_id = $2 
                 AND status NOT IN ('rejected', 'company_rejected')
               LIMIT 1`,
              [studentUserId, companyId]
            );
            if ((intentCheck.rowCount ?? 0) > 0) {
              isAuthorizedPartner = true;
            }
          }
        }
      }

      // A mentor grades the report book, so they have to be able to open it.
      // Round 11 pointed both the advisor and student screens at this endpoint
      // and added the `final_reports` category, but the mentor's own screen was
      // still linking at http://localhost:5000/uploads/… — so nobody noticed
      // that repointing it alone would only turn a dead link into a 403.
      if (!isAuthorizedPartner && userRoles.includes('mentor') && category === 'final_reports' && userId !== undefined) {
        const match = safeName.match(/^finalreport-user-(\d+)-/);
        const studentUserId = match ? parseInt(match[1], 10) : null;
        if (studentUserId) {
          const supervisedCheck = await query(
            `SELECT 1 FROM intent_forms
             WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted'
             LIMIT 1`,
            [studentUserId, userId]
          );
          if ((supervisedCheck.rowCount ?? 0) > 0) {
            isAuthorizedPartner = true;
          }
        }
      }

      if (!isAuthorizedPartner) {
        const filePrefix = `resume-user-${userId}-`;
        const evidencePrefix = `evidence-user-${userId}-`;
        // multer names these `finalreport-user-<id>-…`, so the owner test is the
        // same shape as the other three.
        const reportPrefix = `finalreport-user-${userId}-`;
        const requestFormPrefix = `requestform-user-${userId}-`;
        // รูปโปรไฟล์ — multer ตั้งชื่อ `avatar-user-<id>-…` รูปแบบเดียวกับที่เหลือ
        const avatarPrefix = `avatar-user-${userId}-`;

        const isOwner =
          safeName.startsWith(filePrefix) ||
          safeName.startsWith(evidencePrefix) ||
          safeName.startsWith(reportPrefix) ||
          safeName.startsWith(requestFormPrefix) ||
          safeName.startsWith(avatarPrefix);
        if (!isOwner) {
          res.status(403).json({ message: 'Forbidden. You do not have access to this file.' });
          return;
        }
      }
    }

    // Only now, once the caller has been shown to be entitled to this file, does
    // a missing one fall back to the blank template.
    if (!fs.existsSync(filePath)) {
      // ⚠️ fallback นี้ชี้ไปแม่แบบที่ถูกโละไปแล้ว 2026-08-26 จึงไม่มีวันเจอไฟล์
      // ปล่อยไว้เฉยๆ ไม่ได้ทำอันตราย แต่ผลจริงคือทุกกรณีตกไปที่ 404 ด้านล่าง
      // ซึ่งเป็นพฤติกรรมที่ถูกต้องกว่าการคืนแม่แบบเปล่าอยู่แล้ว
      if (['resumes', 'acceptance_evidence'].includes(category)) {
        const fallbackPath = path.join(process.cwd(), 'secure_private', 'templates', 'cover_letter_template.pdf');
        if (fs.existsSync(fallbackPath)) {
          res.sendFile(fallbackPath);
          return;
        }
      }
      res.status(404).json({ message: 'File not found.' });
      return;
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

/**
 * ฟอนต์ราชการสำหรับหน้าที่ต้องสั่งพิมพ์ (แบบคำร้อง เอกสารหมายเลข 1)
 *
 * ⛔ นี่คือ **ทางเดียว** ที่ไฟล์ใน `secure_private/` ถูกเปิดสาธารณะ และเปิดเฉพาะ
 * โฟลเดอร์ `fonts/` เท่านั้น — TH Sarabun New เป็น GPL2 + font exception ของ
 * DIP/SIPA แจกจ่ายได้อยู่แล้ว ไม่ใช่ความลับ (ต่างจาก `signatures/` กับ `documents/`
 * ที่ห้ามเปิดเด็ดขาด) · ห้ามเลื่อน mount นี้ขึ้นไปที่ `secure_private` ตรงๆ
 *
 * เหตุผลที่ต้องมี: หน้าแบบคำร้องเดิมประกาศ `font-family: 'TH SarabunPSK', …`
 * เฉยๆ แล้วหวังว่าเครื่องนักศึกษาจะมีฟอนต์ติดตั้งอยู่ ถ้าไม่มีจะตกไป Tahoma
 * ซึ่งตัวโตกว่ามากจนแบบฟอร์มล้นหน้า (เจอตอนเดินหน้าจอจริง 2026-08-27)
 */
app.use(
  '/assets/fonts',
  express.static(path.join(process.cwd(), 'secure_private', 'fonts'), {
    maxAge: '30d',
    immutable: true,
  })
);

// API Base Routing
app.use('/api', apiRouter);


// Basic Route for Healthcheck
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 Route handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: `Route '${req.originalUrl}' not found.` });
});

/**
 * Centralized error handling middleware
 *
 * เดิมตอบ 500 กับทุกอย่างที่หลุดมาถึงตรงนี้ ซึ่งผิดสำหรับ error ที่ *เกิดจากคำขอ*
 * ไม่ใช่จากเซิร์ฟเวอร์ — และการยิง fuzz ทำให้เห็นสองกรณีที่เจอได้จากการใช้งานปกติ:
 * ส่ง JSON ใหญ่เกิน 100KB (ค่า default ของ body-parser) และกรอกข้อความยาวเกิน
 * ความกว้างคอลัมน์ ทั้งคู่เคยได้ 500 + "เกิดข้อผิดพลาดของระบบ" ซึ่งบอกผู้ใช้ไม่ได้
 * ว่าต้องแก้อะไร และกลบ error จริงใน log ด้วยคำว่า "Unhandled"
 *
 * 5xx จึงเหลือไว้สำหรับความผิดพลาดของเราจริงๆ เท่านั้น
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const type = (err as { type?: string }).type;
  const pgCode = (err as { code?: string }).code;

  if (type === 'entity.too.large') {
    res.status(413).json({ message: 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินกำหนด กรุณาลดขนาดแล้วลองใหม่' });
    return;
  }

  if (type === 'entity.parse.failed') {
    res.status(400).json({ message: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง' });
    return;
  }

  // 22001 = value too long for type · 22P02 = invalid text representation
  // (เช่นส่งตัวอักษรให้คอลัมน์ตัวเลข) — ทั้งคู่คือคำขอที่ผิด ไม่ใช่เซิร์ฟเวอร์พัง
  if (pgCode === '22001' || pgCode === '22P02') {
    res.status(400).json({ message: 'ข้อมูลที่กรอกยาวเกินกำหนดหรือมีรูปแบบไม่ถูกต้อง' });
    return;
  }

  // ไฟล์ที่ multer ปฏิเสธ — นามสกุลไม่ถูกต้อง (`fileFilter`) หรือใหญ่เกินกำหนด
  //
  // ⛔ ของพวกนี้เคยตกมาถึงบรรทัดล่างแล้วได้ **500 + "เกิดข้อผิดพลาดของระบบ"**
  //    ทั้งที่เป็นคำขอที่ผิด ไม่ใช่เซิร์ฟเวอร์พัง — ขัดกับกฎที่เขียนไว้หัวไฟล์นี้เอง
  //    และผู้ใช้ไม่มีทางรู้ว่าต้องแก้อะไร · ครอบทุกตัวอัปโหลดในระบบทีเดียว
  //    (เจอตอนเพิ่มตัวอัปโหลดรูปโปรไฟล์ตัวที่ 8 เมื่อ 2026-09-03)
  const isMulterError =
    err.name === 'MulterError' || /^Invalid (file|image) type\./.test(err.message);
  if (isMulterError) {
    const tooLarge = (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      message: tooLarge ? 'ไฟล์มีขนาดใหญ่เกินกำหนด' : err.message,
    });
    return;
  }

  console.error('Unhandled server error:', err);
  res.status(500).json({
    message: 'An unexpected error occurred on the server.',
    error: process.env.NODE_ENV !== 'production' ? err.message : undefined,
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`🚀 Server running on port: ${PORT}`);
  console.log(`👉 Healthcheck: http://localhost:${PORT}/health`);
  console.log(`👉 API routes prefix: http://localhost:${PORT}/api`);
  console.log(`========================================================`);

  // Start the automatic user deactivation checker
  initDeactivationScheduler();
});
