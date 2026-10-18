import React from 'react';

interface MentorStudentContactProps {
  student: {
    name_prefix?: string | null;
    full_name: string;
    nickname?: string | null;
    phone?: string | null;
    email?: string | null;
    parent_name?: string | null;
    parent_phone?: string | null;
  };
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <dt className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</dt>
    <dd className="break-words text-sm font-semibold text-gray-900 dark:text-gray-100">{children}</dd>
  </div>
);

const link = 'text-brand-blue underline hover:no-underline dark:text-blue-400';
const missing = <span className="font-normal text-gray-600 dark:text-gray-400">ไม่ได้ระบุ</span>;

/**
 * ข้อมูลติดต่อนักศึกษาสำหรับพี่เลี้ยง — เฉพาะที่ต้องใช้ดูแล: ชื่อ ชื่อเล่น เบอร์ อีเมล ผู้ปกครอง
 * ⛔ ไม่แสดงเกรด เลขบัตร ที่อยู่ หรือเรซูเม่ · เซิร์ฟเวอร์ส่งมาเฉพาะนักศึกษาที่พี่เลี้ยงคนนี้ดูแล (`/mentor/pending`)
 */
const MentorStudentContact: React.FC<MentorStudentContactProps> = ({ student }) => (
  <dl
    data-testid="mentor-student-contact"
    className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-800 dark:bg-gray-800/40"
  >
    <Row label="ชื่อ-นามสกุล">
      {`${student.name_prefix ?? ''}${student.full_name}`.trim() || missing}
    </Row>
    <Row label="ชื่อเล่น">{student.nickname || missing}</Row>
    <Row label="เบอร์โทรนักศึกษา">
      {student.phone ? (
        <a href={`tel:${student.phone}`} className={link}>
          {student.phone}
        </a>
      ) : (
        missing
      )}
    </Row>
    <Row label="อีเมล">
      {student.email ? (
        <a href={`mailto:${student.email}`} className={link}>
          {student.email}
        </a>
      ) : (
        missing
      )}
    </Row>
    <Row label="ผู้ปกครอง">{student.parent_name || missing}</Row>
    <Row label="เบอร์โทรผู้ปกครอง">
      {student.parent_phone ? (
        <a href={`tel:${student.parent_phone}`} className={link}>
          {student.parent_phone}
        </a>
      ) : (
        missing
      )}
    </Row>
  </dl>
);

export default MentorStudentContact;
