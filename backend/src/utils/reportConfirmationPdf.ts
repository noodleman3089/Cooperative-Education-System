import { ThaiPdf } from './thaiPdf';
import { query } from '../config/database';

export interface ReportConfirmationData {
  student_code: string;
  student_name: string;
  major_name: string;
  faculty_name: string;
  company_name: string;
  report_title: string;
  advisor_name: string;
  requested_at: string | null;
  certified_at: string | null;
  status: string;
}

export async function fetchReportConfirmationData(studentId: number): Promise<ReportConfirmationData | null> {
  const res = await query(
    `SELECT
       s.student_code,
       s.first_name || ' ' || s.last_name AS student_name,
       COALESCE(m.major_name_th, 'ไม่ระบุสาขา') AS major_name,
       COALESCE(fac.faculty_name_th, 'ไม่ระบุคณะ') AS faculty_name,
       COALESCE(c.name_th, 'ไม่ระบุสถานประกอบการ') AS company_name,
       COALESCE(rov.report_title, ro_draft.report_title, 'ไม่ระบุหัวข้อรายงาน') AS report_title,
       COALESCE(p.first_name || ' ' || p.last_name, 'อาจารย์ที่ปรึกษา') AS advisor_name,
       rc.requested_at,
       rc.certified_at,
       COALESCE(rc.status, 'pending') AS status
     FROM students s
     LEFT JOIN master_major m ON s.major_id = m.major_id
     LEFT JOIN master_faculty fac ON m.faculty_id = fac.faculty_id
     LEFT JOIN personnel p ON s.advisor_id = p.personnel_id
     LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status = 'accepted'
     LEFT JOIN companies c ON i.company_id = c.company_id
     LEFT JOIN report_outlines ro ON s.student_id = ro.student_id
     LEFT JOIN (
       SELECT outline_id, report_title
       FROM report_outline_versions
       WHERE status IN ('approved', 'approved_without_mentor')
       ORDER BY version_id DESC LIMIT 1
     ) rov ON ro.outline_id = rov.outline_id
     LEFT JOIN (
       SELECT outline_id, report_title
       FROM report_outline_versions
       ORDER BY version_id DESC LIMIT 1
     ) ro_draft ON ro.outline_id = ro_draft.outline_id
     LEFT JOIN report_confirmations rc ON s.student_id = rc.student_id
     WHERE s.student_id = $1
     ORDER BY i.form_id DESC LIMIT 1`,
    [studentId]
  );

  if ((res.rowCount ?? 0) === 0) return null;
  return res.rows[0];
}

const formatThaiDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export async function drawReportConfirmationPdf(data: ReportConfirmationData): Promise<Buffer> {
  const pdf = await ThaiPdf.create({ margin: 60, top: 50, bottom: 50 });

  // Header
  pdf.line('สหกิจศึกษา ๑๔', { size: 18, align: 'center' });
  pdf.space(4);
  pdf.line('แบบแจ้งยืนยันการส่งรายงานการปฏิบัติงานสหกิจศึกษา', { size: 16, align: 'center' });
  pdf.line('โครงการสหกิจศึกษา มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก', { size: 14, align: 'center' });
  pdf.space(16);

  // Content lines
  pdf.line(`ชื่อ - นามสกุล นักศึกษา: ${data.student_name}    รหัสนักศึกษา: ${data.student_code}`, { size: 15 });
  pdf.space(4);
  pdf.line(`สาขาวิชา: ${data.major_name}    คณะ: ${data.faculty_name}`, { size: 15 });
  pdf.space(4);
  pdf.line(`สถานประกอบการ: ${data.company_name}`, { size: 15 });
  pdf.space(4);
  pdf.line(`หัวข้อรายงานสหกิจศึกษา: ${data.report_title}`, { size: 15 });
  pdf.space(16);

  pdf.line('ขอแจ้งยืนยันการส่งรายงานการปฏิบัติงานสหกิจศึกษาฉบับสมบูรณ์', { size: 15 });
  pdf.line('โดยได้รับการตรวจสอบและเห็นชอบจากอาจารย์ที่ปรึกษาสหกิจศึกษาเรียบร้อยแล้ว', { size: 15 });
  pdf.space(8);
  pdf.line(`วันที่ยื่นขอยืนยัน: ${formatThaiDate(data.requested_at)}`, { size: 14 });
  pdf.space(20);

  // Certification block
  pdf.line('------------------------------------------------------------------------------------------------------------------------', { size: 10 });
  pdf.space(10);
  pdf.line('ส่วนการรับรองโดยอาจารย์ที่ปรึกษาสหกิจศึกษา', { size: 15, align: 'center' });
  pdf.space(10);

  const certStatusText = data.status === 'certified'
    ? `ได้รับการรับรองแล้วเมื่อวันที่ ${formatThaiDate(data.certified_at)}`
    : 'อยู่ระหว่างรออาจารย์ที่ปรึกษาลงนามรับรอง';

  pdf.line(`สถานะการรับรอง: ${certStatusText}`, { size: 14 });
  pdf.space(8);
  pdf.line('ข้าพเจ้าได้ตรวจสอบรายงานการปฏิบัติงานสหกิจศึกษาฉบับสมบูรณ์ของนักศึกษาดังกล่าวแล้ว', { size: 14 });
  pdf.line('ขอรับรองว่ารายงานมีความครบถ้วนสมบูรณ์ตามเกณฑ์ของหลักสูตรสหกิจศึกษาทุกประการ', { size: 14 });
  pdf.space(32);

  // Signature lines
  pdf.line('ลงชื่อ ................................................................ อาจารย์ที่ปรึกษา', { size: 14 });
  pdf.space(6);
  pdf.line(`      ( ${data.advisor_name} )`, { size: 14 });
  pdf.space(6);
  pdf.line('วันที่ ........ เดือน .................... พ.ศ. ............', { size: 14 });

  return await pdf.save();
}
