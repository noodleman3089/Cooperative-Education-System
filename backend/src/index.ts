import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { xssSanitizer } from './middlewares/validation';
import { authenticateToken } from './middlewares/auth';
import { AUTH_COOKIE } from './utils/authCookie';
import apiRouter from './routes';
import { query } from './config/database';
import { initDeactivationScheduler } from './utils/deactivationScheduler';

// Load environment variables
dotenv.config();

// Enforce JWT_SECRET configuration (CRIT-01)
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not configured.');
  process.exit(1);
}

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
      frameSrc: ["'self'", "https://accounts.google.com", "https://demo.docusign.net"],
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
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV !== 'production' ? 10000 : 100, // Limit each IP to 100 general requests (10000 in dev)
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

// Helper to authenticate the session from the httpOnly cookie.
const verifyTokenHelper = (req: Request): any => {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return null;
  try {
    // Fix Task 1.1: Enforce JWT_SECRET and remove fallback secret to prevent JWT forgery
    return jwt.verify(token, process.env.JWT_SECRET!);
  } catch (err) {
    return null;
  }
};

// Route: GET /api/files/download/parental-consent-template (Pre-filled PDF template)
app.get('/api/files/download/parental-consent-template', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decoded = verifyTokenHelper(req);
    if (!decoded) {
      res.status(401).json({ message: 'Unauthorized. Invalid or missing token.' });
      return;
    }

    const intentId = parseInt(req.query.intent_id as string, 10);
    if (isNaN(intentId)) {
      res.status(400).json({ message: 'Invalid intent ID.' });
      return;
    }

    // Fetch intent, student, major and company details
    const result = await query(
      `SELECT i.form_id, i.student_id, s.student_code, m.major_name_th,
              c.name_th as company_name_th, u.email as student_email
       FROM intent_forms i
       JOIN students s ON i.student_id = s.student_id
       JOIN master_major m ON s.major_id = m.major_id
       JOIN companies c ON i.company_id = c.company_id
       JOIN users u ON s.student_id = u.user_id
       WHERE i.form_id = $1 LIMIT 1`,
      [intentId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: 'Intent form not found.' });
      return;
    }

    const row = result.rows[0];

    // Check authorization: only the student owner or staff roles can download
    const isStaff = decoded.roles.some((r: string) => ['staff', 'dean', 'advisor', 'dept_head'].includes(r));
    const isOwner = decoded.roles.includes('student') && row.student_id === decoded.userId;

    if (!isStaff && !isOwner) {
      res.status(403).json({ message: 'Forbidden. You do not have access to this form.' });
      return;
    }

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    
    const fontPath = path.join(process.cwd(), 'secure_private', 'fonts', 'Srabun-Regular.ttf');
    let customFont;
    if (fs.existsSync(fontPath) && fs.statSync(fontPath).size > 0) {
      try {
        const fontBytes = fs.readFileSync(fontPath);
        customFont = await pdfDoc.embedFont(fontBytes);
      } catch (err) {
        console.error('Failed to embed Thai font:', err);
      }
    }

    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    
    // Draw text with Thai font
    page.drawText('หนังสือแสดงความยินยอมของผู้ปกครอง', { x: 160, y: 770, size: 18, font: customFont });
    page.drawText('ในการอนุญาตให้นักศึกษาเข้าปฏิบัติงานสหกิจศึกษา', { x: 130, y: 740, size: 16, font: customFont });

    const contentText = 
      `ข้าพเจ้า (ผู้ปกครอง) ยินยอมให้นักศึกษา นาย/นางสาว ${row.student_email.split('@')[0]} \n` +
      `รหัสนักศึกษา: ${row.student_code}    สาขาวิชา: ${row.major_name_th} \n` +
      `เข้าฝึกปฏิบัติงานสหกิจศึกษา ณ สถานประกอบการ ${row.company_name_th} \n\n` +
      `โดยข้าพเจ้ายินดีและรับรองความประพฤติของนักศึกษาระหว่างปฏิบัติงานดังกล่าว`;

    const lines = contentText.split('\n');
    let currentY = 660;
    for (const line of lines) {
      page.drawText(line, { x: 60, y: currentY, size: 13, font: customFont });
      currentY -= 25;
    }

    page.drawText('ลงชื่อ...................................................... ผู้ปกครอง', { x: 280, y: 450, size: 13, font: customFont });
    page.drawText('(......................................................)', { x: 315, y: 420, size: 13, font: customFont });
    page.drawText('ลงชื่อ...................................................... นักศึกษา', { x: 280, y: 350, size: 13, font: customFont });
    page.drawText(`( ${row.student_email.split('@')[0]} )`, { x: 315, y: 320, size: 13, font: customFont });

    const pdfBytes = await pdfDoc.save();
    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="consent-template-${row.student_code}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    next(error);
  }
});

// Route: GET /api/files/download/travel-request-template (Advisor travel request memo PDF)
app.get('/api/files/download/travel-request-template', authenticateToken, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const templateFilePath = path.join(process.cwd(), 'secure_private', 'templates', 'travel_request_template.html');
    
    if (!fs.existsSync(templateFilePath)) {
      res.status(404).json({ message: 'Travel request template not found.' });
      return;
    }

    const htmlSource = fs.readFileSync(templateFilePath, 'utf8');
    const compiledTemplate = Handlebars.compile(htmlSource);

    const thaiDate = new Date().toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const destinationsQuery = await query(`
      SELECT s.student_code, s.first_name || ' ' || s.last_name as student_name,
             c.name_th as company_name, c.province
      FROM intent_forms i
      JOIN students s ON i.student_id = s.student_id
      JOIN companies c ON i.company_id = c.company_id
      WHERE i.status = 'accepted'
      LIMIT 5
    `);

    let destinations = destinationsQuery.rows.map((row, idx) => ({
      no: idx + 1,
      student_name: row.student_name,
      student_code: row.student_code,
      company_name: row.company_name,
      province: row.province || 'ชลบุรี',
      advisor_name: 'อาจารย์ผู้ดูแล'
    }));

    if (destinations.length === 0) {
      destinations = [{
        no: 1,
        student_name: 'นักศึกษาสหกิจศึกษา',
        student_code: '64010001',
        company_name: 'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด',
        province: 'สมุทรปราการ',
        advisor_name: 'อาจารย์ผู้ดูแล'
      }];
    }

    const renderedHtml = compiledTemplate({
      document_number: `ศธ ๐๖๒๒/ว ${(Math.floor(Math.random() * 900) + 100).toString()}`,
      current_date: thaiDate,
      travel_date: thaiDate,
      transport_type: 'รถยนต์ส่วนบุคคล / รถยนต์คณะวิทยาศาสตร์ฯ',
      destinations: destinations,
      applicant_name: 'อาจารย์ผู้นิเทศก์การปฏิบัติงานสหกิจศึกษา'
    });

    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(renderedHtml, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({ 
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '25mm', right: '20mm' }
    });
    await browser.close();

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="travel_request.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// Route: GET /api/files/documents/:doc_id (Retrieve generated cover/transfer letters)
app.get('/api/files/documents/:doc_id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docId = parseInt(req.params.doc_id, 10);
    if (isNaN(docId)) {
      res.status(400).json({ message: 'Invalid document ID.' });
      return;
    }

    const docQuery = await query(
      `SELECT d.generated_file_path, d.student_id
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

    let filePath = doc.generated_file_path ? path.join(process.cwd(), doc.generated_file_path) : '';
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
    
    const allowedCategories = ['resumes', 'signatures', 'acceptance_evidence', 'parental_consents'];
    if (!allowedCategories.includes(category)) {
      res.status(404).json({ message: 'Category not found.' });
      return;
    }

    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), 'uploads', category, safeName);

    if (!fs.existsSync(filePath)) {
      if (['resumes', 'parental_consents', 'acceptance_evidence'].includes(category)) {
        const fallbackPath = path.join(process.cwd(), 'secure_private', 'templates', 'cover_letter_template.pdf');
        if (fs.existsSync(fallbackPath)) {
          res.sendFile(fallbackPath);
          return;
        }
      }
      res.status(404).json({ message: 'File not found.' });
      return;
    }

    const userRoles = req.user?.roles || [];
    const userId = req.user?.userId;

    const isStaff = userRoles.some(r => ['staff', 'dean', 'advisor', 'dept_head'].includes(r));
    
    if (!isStaff) {
      let isAuthorizedCompany = false;
      
      if (userRoles.includes('company') && category === 'resumes' && userId !== undefined) {
        const match = safeName.match(/^resume-user-(\d+)-/);
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
              isAuthorizedCompany = true;
            }
          }
        }
      }

      if (!isAuthorizedCompany) {
        const filePrefix = `resume-user-${userId}-`;
        const evidencePrefix = `evidence-user-${userId}-`;
        const consentPrefix = `consent-user-${userId}-`;
        
        const isOwner = safeName.startsWith(filePrefix) || safeName.startsWith(evidencePrefix) || safeName.startsWith(consentPrefix);
        if (!isOwner) {
          res.status(403).json({ message: 'Forbidden. You do not have access to this file.' });
          return;
        }
      }
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

// API Base Routing
app.use('/api', apiRouter);

// Frontend test client dashboard (ponytail: extracted to external static file to keep index.ts readable)
if (process.env.NODE_ENV !== 'production') {
  app.get('/dashboard', (_req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), 'secure_private', 'templates', 'dashboard.html'));
  });
}


// Basic Route for Healthcheck
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 Route handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: `Route '${req.originalUrl}' not found.` });
});

// Centralized error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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
