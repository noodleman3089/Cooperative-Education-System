/**
 * ตัวเลือก "งานที่สนใจ" ของนักศึกษา — แหล่งความจริงที่เดียว
 *
 * รายการสองชุดนี้เคยถูกคัดลอกไว้ใน `StudentProfile.tsx` และ `StudentProfileExtra.tsx`
 * คนละก๊อป พอหน้ากรอกข้อมูลครั้งแรกต้องใช้ด้วยก็จะเป็นก๊อปที่สาม — และตัวเลือกพวกนี้
 * ถูกเก็บลงฐานเป็น **ค่าสตริงตรงๆ** ใน `students.interested_job_types` (JSONB)
 * แปลว่าถ้าสามที่เขียนข้อความไม่ตรงกันแม้แต่ตัวอักษรเดียว ค่าที่บันทึกจะกลายเป็น
 * คนละตัวเลือกกันโดยไม่มีอะไรฟ้อง — ตัวกรองหางานจะหาไม่เจอเงียบๆ
 *
 * ⛔ **แก้ข้อความในนี้ = แก้ค่าที่จะถูกเขียนลงฐานตั้งแต่นั้นไป** ของเก่าที่บันทึกไว้แล้ว
 * ไม่เปลี่ยนตาม ถ้าจำเป็นต้องเปลี่ยนคำ ต้องเขียน migration ตามไปแก้แถวเดิมด้วย
 */

export const JOB_TYPE_OPTIONS = [
  'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
  'งานวิศวกรรม (Engineering)',
  'งานออกแบบ (Design)',
  'งานวิจัยและพัฒนา (R&D)',
  'งานห้องปฏิบัติการ (Lab)',
  'งานภาคสนาม (Fieldwork)',
  'งานการตลาดและการขาย (Marketing & Sales)',
  'งานโรงงานและฝ่ายผลิต (Production)',
  'งานโลจิสติกส์และซัพพลายเชน (Logistics & Supply Chain)',
  'งานบัญชีและการเงิน (Accounting & Finance)',
  'งานทรัพยากรบุคคลและการจัดการ (HR & Management)',
  'งานเอกสารและธุรการ (Admin)',
  'งานเกษตร เทคโนโลยีอาหาร และสิ่งแวดล้อม (Agri & Food Science)',
  'งานการโรงแรมและการท่องเที่ยว (Hospitality & Tourism)',
] as const;

export const WORK_REGION_OPTIONS = [
  'กรุงเทพมหานครและปริมณฑล',
  'ภาคกลาง',
  'ภาคตะวันออก',
  'ภาคเหนือ',
  'ภาคตะวันออกเฉียงเหนือ (อีสาน)',
  'ภาคใต้',
  'ภาคตะวันตก',
  'ต่างประเทศ',
] as const;

/**
 * แผนที่จับคู่สาขาวิชากับงานที่แนะนำ (ตามรหัสสาขา master_major หรือคำค้นในชื่อสาขา)
 */
export const MAJOR_RECOMMENDED_JOBS: Record<string, readonly string[]> = {
  CS01: [
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานออกแบบ (Design)',
    'งานวิจัยและพัฒนา (R&D)',
  ],
  IT01: [
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานออกแบบ (Design)',
    'งานวิจัยและพัฒนา (R&D)',
    'งานเอกสารและธุรการ (Admin)',
  ],
  CPE01: [
    'งานวิศวกรรม (Engineering)',
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานโรงงานและฝ่ายผลิต (Production)',
    'งานวิจัยและพัฒนา (R&D)',
  ],
  MM01: [
    'งานออกแบบ (Design)',
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานการตลาดและการขาย (Marketing & Sales)',
  ],
  IS01: [
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานเอกสารและธุรการ (Admin)',
    'งานบัญชีและการเงิน (Accounting & Finance)',
    'งานการตลาดและการขาย (Marketing & Sales)',
  ],
  MGT01: [
    'งานทรัพยากรบุคคลและการจัดการ (HR & Management)',
    'งานเอกสารและธุรการ (Admin)',
    'งานการตลาดและการขาย (Marketing & Sales)',
  ],
  MKT01: [
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานออกแบบ (Design)',
    'งานเอกสารและธุรการ (Admin)',
  ],
  PR01: [
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานออกแบบ (Design)',
    'งานเอกสารและธุรการ (Admin)',
  ],
  ACC01: [
    'งานบัญชีและการเงิน (Accounting & Finance)',
    'งานเอกสารและธุรการ (Admin)',
  ],
  LOG01: [
    'งานโลจิสติกส์และซัพพลายเชน (Logistics & Supply Chain)',
    'งานโรงงานและฝ่ายผลิต (Production)',
    'งานเอกสารและธุรการ (Admin)',
  ],
  ECO01: [
    'งานบัญชีและการเงิน (Accounting & Finance)',
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานวิจัยและพัฒนา (R&D)',
  ],
  DIB01: [
    'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานออกแบบ (Design)',
    'งานทรัพยากรบุคคลและการจัดการ (HR & Management)',
  ],
  LANG01: [
    'งานเอกสารและธุรการ (Admin)',
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานการโรงแรมและการท่องเที่ยว (Hospitality & Tourism)',
    'งานทรัพยากรบุคคลและการจัดการ (HR & Management)',
  ],
  GEN01: [
    'งานเอกสารและธุรการ (Admin)',
    'งานทรัพยากรบุคคลและการจัดการ (HR & Management)',
  ],
  TH01: [
    'งานการโรงแรมและการท่องเที่ยว (Hospitality & Tourism)',
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานเอกสารและธุรการ (Admin)',
  ],
  SM01: [
    'งานทรัพยากรบุคคลและการจัดการ (HR & Management)',
    'งานการตลาดและการขาย (Marketing & Sales)',
    'งานเอกสารและธุรการ (Admin)',
  ],
};

/**
 * ดึงรายการงานที่แนะนำตามสาขาวิชา (ค้นจาก major_code หรือชื่อสาขา)
 * ponytail: O(1) direct code lookup + O(k) keyword fallback
 */
export function getRecommendedJobTypes(majorCodeOrName?: string | null): string[] {
  if (!majorCodeOrName) return [];
  const target = majorCodeOrName.trim();
  const upper = target.toUpperCase();

  if (MAJOR_RECOMMENDED_JOBS[upper]) {
    return [...MAJOR_RECOMMENDED_JOBS[upper]];
  }

  for (const [code, list] of Object.entries(MAJOR_RECOMMENDED_JOBS)) {
    if (upper.startsWith(code) || upper.includes(code)) {
      return [...list];
    }
  }

  if (target.includes('คอมพิวเตอร์') || target.includes('สารสนเทศ')) {
    return [
      'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
      'งานออกแบบ (Design)',
      'งานวิจัยและพัฒนา (R&D)',
    ];
  }
  if (target.includes('วิศว')) {
    return [
      'งานวิศวกรรม (Engineering)',
      'งานไอทีและโปรแกรมมิ่ง (IT/Programming)',
      'งานโรงงานและฝ่ายผลิต (Production)',
    ];
  }
  if (target.includes('บัญชี')) {
    return [
      'งานบัญชีและการเงิน (Accounting & Finance)',
      'งานเอกสารและธุรการ (Admin)',
    ];
  }
  if (target.includes('โลจิสติกส์') || target.includes('ขนส่ง')) {
    return [
      'งานโลจิสติกส์และซัพพลายเชน (Logistics & Supply Chain)',
      'งานโรงงานและฝ่ายผลิต (Production)',
      'งานเอกสารและธุรการ (Admin)',
    ];
  }
  if (target.includes('ตลาด') || target.includes('โฆษณา')) {
    return [
      'งานการตลาดและการขาย (Marketing & Sales)',
      'งานออกแบบ (Design)',
      'งานเอกสารและธุรการ (Admin)',
    ];
  }
  if (target.includes('ท่องเที่ยว') || target.includes('โรงแรม')) {
    return [
      'งานการโรงแรมและการท่องเที่ยว (Hospitality & Tourism)',
      'งานการตลาดและการขาย (Marketing & Sales)',
      'งานเอกสารและธุรการ (Admin)',
    ];
  }
  if (target.includes('เกษตร') || target.includes('อาหาร')) {
    return [
      'งานเกษตร เทคโนโลยีอาหาร และสิ่งแวดล้อม (Agri & Food Science)',
      'งานห้องปฏิบัติการ (Lab)',
      'งานวิจัยและพัฒนา (R&D)',
    ];
  }

  return [];
}

