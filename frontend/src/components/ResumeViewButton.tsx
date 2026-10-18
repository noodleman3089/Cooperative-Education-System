import React from 'react';
import { API_BASE_URL } from '../services/api';
import FileViewButton from './FileViewButton';

interface ResumeViewButtonProps {
  /** `resumes/<ชื่อไฟล์>` ตามที่เก็บใน `students.resume_file` — ว่าง = นักศึกษายังไม่ได้อัปโหลด */
  resumeFile: string | null | undefined;
  'data-testid'?: string;
}

/**
 * ปุ่ม "ดูเรซูเม่" — เปิดดูเฉพาะไฟล์เรซูเม่ที่นักศึกษาอัปโหลด ไม่แสดงข้อมูลอื่นปนมา
 * ใช้ในหน้าจอของฝ่ายที่ตรวจคำร้อง (เจ้าหน้าที่ · อาจารย์ · หัวหน้าสาขา) · สิทธิ์เปิดไฟล์ตัดสินที่เซิร์ฟเวอร์
 * (`/files/download/resumes/…`) ปุ่มนี้แค่พาไปเปิด — ไม่มีสิทธิ์เองจะได้ข้อความ "เปิดไฟล์ไม่สำเร็จ"
 */
const ResumeViewButton: React.FC<ResumeViewButtonProps> = ({ resumeFile, 'data-testid': testId }) => {
  if (!resumeFile) {
    return (
      <span data-testid={testId ? `${testId}-missing` : undefined} className="text-xs text-gray-600 dark:text-gray-400">
        นักศึกษายังไม่ได้อัปโหลดเรซูเม่
      </span>
    );
  }
  const fileName = resumeFile.split('/').pop() ?? resumeFile;
  return (
    <FileViewButton
      src={`${API_BASE_URL}/files/download/resumes/${fileName}`}
      title="เรซูเม่ของนักศึกษา"
      label="ดูเรซูเม่"
      data-testid={testId}
    />
  );
};

export default ResumeViewButton;
