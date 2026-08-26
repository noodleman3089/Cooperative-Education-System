import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

/**
 * ลายเซ็นของ fileFilter ตามที่ multer ประกาศไว้เอง — ใช้ซ้ำทั้ง 5 ตัวกรอง
 * ประกาศแบบนี้แล้ว _req กับ file ถูก contextual-type ให้อัตโนมัติ ไม่ต้อง import อะไรเพิ่ม
 * และ `as any` ตอนส่งเข้า multer() ก็ไม่จำเป็นอีก
 */
type FileFilter = NonNullable<multer.Options['fileFilter']>;

// Base upload directories
const UPLOADS_BASE_DIR = path.join(process.cwd(), 'uploads');
const RESUMES_DIR = path.join(UPLOADS_BASE_DIR, 'resumes');
const SIGNATURES_DIR = path.join(UPLOADS_BASE_DIR, 'signatures');
const EVIDENCES_DIR = path.join(UPLOADS_BASE_DIR, 'acceptance_evidence');

// Ensure directories exist
if (!fs.existsSync(UPLOADS_BASE_DIR)) {
  fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
}
if (!fs.existsSync(RESUMES_DIR)) {
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
}
if (!fs.existsSync(SIGNATURES_DIR)) {
  fs.mkdirSync(SIGNATURES_DIR, { recursive: true });
}
if (!fs.existsSync(EVIDENCES_DIR)) {
  fs.mkdirSync(EVIDENCES_DIR, { recursive: true });
}
// 1. Resume Upload Configuration (PDF/Word documents only, max 5MB)
const resumeStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, RESUMES_DIR);
  },
  filename: (req, file, cb) => {
    // Prefix with user ID to prevent name collisions
    const userId = req.user?.userId || 'unknown';
    const cleanOrigName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `resume-user-${userId}-${uniqueSuffix}${path.extname(cleanOrigName)}`);
  },
});

const resumeFileFilter: FileFilter = (_req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and Word documents (.doc, .docx) are allowed.'));
  }
};

export const uploadResume = multer({
  storage: resumeStorage,
  fileFilter: resumeFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// 2. Signature Upload Configuration (Images only, max 2MB)
const signatureStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, SIGNATURES_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const cleanOrigName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `signature-user-${userId}-${uniqueSuffix}${path.extname(cleanOrigName)}`);
  },
});

const signatureFileFilter: FileFilter = (_req, file, cb) => {
  const allowedExtensions = ['.png', '.jpg', '.jpeg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image type. Only PNG, JPG, and JPEG images are allowed.'));
  }
};

export const uploadSignature = multer({
  storage: signatureStorage,
  fileFilter: signatureFileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit
  },
});

// 3. Acceptance Evidence Upload Configuration (PDF/Images only, max 5MB)
const evidenceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, EVIDENCES_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const cleanOrigName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `evidence-user-${userId}-${uniqueSuffix}${path.extname(cleanOrigName)}`);
  },
});

const evidenceFileFilter: FileFilter = (_req, file, cb) => {
  const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and images (.png, .jpg, .jpeg) are allowed.'));
  }
};

export const uploadEvidence = multer({
  storage: evidenceStorage,
  fileFilter: evidenceFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

export const validateUploadedFile = (allowedTypes: ('pdf' | 'doc' | 'docx' | 'png' | 'jpg')[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) {
      return next();
    }

    try {
      const filePath = req.file.path;
      
      // Read the first 8 bytes of the file
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(8);
      fs.readSync(fd, buffer, 0, 8, 0);
      fs.closeSync(fd);

      // Check PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
      const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;

      // Check PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;

      // Check JPEG magic bytes: 0xFF 0xD8 0xFF
      const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

      // Check DOCX / ZIP magic bytes: PK (0x50 0x4B 0x03 0x04)
      const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;

      // Check DOC magic bytes: 0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
      const isDoc = buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;

      let isValid = false;
      for (const type of allowedTypes) {
        if (type === 'pdf' && isPdf) isValid = true;
        if (type === 'png' && isPng) isValid = true;
        if (type === 'jpg' && isJpeg) isValid = true;
        if (type === 'docx' && isDocx) isValid = true;
        if (type === 'doc' && isDoc) isValid = true;
      }

      if (!isValid) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        res.status(400).json({ message: 'File content does not match allowed types (magic bytes validation failed).' });
        return;
      }

      next();
    } catch {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400).json({ message: 'Error validating file content.' });
      return;
    }
  };
};

// 5. Report Outline Upload Configuration (PDF/Word only, max 10MB)
const OUTLINES_DIR = path.join(UPLOADS_BASE_DIR, 'report_outlines');
if (!fs.existsSync(OUTLINES_DIR)) {
  fs.mkdirSync(OUTLINES_DIR, { recursive: true });
}
const outlineStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, OUTLINES_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const cleanOrigName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `outline-user-${userId}-${uniqueSuffix}${path.extname(cleanOrigName)}`);
  },
});
export const uploadReportOutline = multer({
  storage: outlineStorage,
  fileFilter: resumeFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// 6. Supervision Evidence Photos (Images only, max 5MB)
const SUPERVISION_PHOTOS_DIR = path.join(UPLOADS_BASE_DIR, 'supervision_photos');
if (!fs.existsSync(SUPERVISION_PHOTOS_DIR)) {
  fs.mkdirSync(SUPERVISION_PHOTOS_DIR, { recursive: true });
}
const supervisionPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, SUPERVISION_PHOTOS_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const cleanOrigName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `supervision-user-${userId}-${uniqueSuffix}${path.extname(cleanOrigName)}`);
  },
});
export const uploadSupervisionPhoto = multer({
  storage: supervisionPhotoStorage,
  fileFilter: signatureFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// 7. Final Report Upload Configuration (PDF only, max 20MB)
const FINAL_REPORTS_DIR = path.join(UPLOADS_BASE_DIR, 'final_reports');
if (!fs.existsSync(FINAL_REPORTS_DIR)) {
  fs.mkdirSync(FINAL_REPORTS_DIR, { recursive: true });
}

const finalReportStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, FINAL_REPORTS_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const cleanOrigName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `finalreport-user-${userId}-${uniqueSuffix}${path.extname(cleanOrigName)}`);
  },
});

const finalReportFileFilter: FileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF documents (.pdf) are allowed.'));
  }
};

export const uploadFinalReport = multer({
  storage: finalReportStorage,
  fileFilter: finalReportFileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
});

