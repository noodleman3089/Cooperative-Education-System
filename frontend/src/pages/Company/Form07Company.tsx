import React from 'react';
import EmptyState from '../../components/ui/EmptyState';

const Form07Company: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          ตำแหน่งงานและพนักงานที่ปรึกษา (สหกิจ 07)
        </h1>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          กรอกรายละเอียดสถานที่ปฏิบัติงาน รายชื่อพนักงานที่ปรึกษา และมอบหมายงานนักศึกษา
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <EmptyState
          title="แบบฟอร์ม สหกิจ 07"
          description="กำลังจัดเตรียมแบบฟอร์ม สหกิจ 07 หน้า 1–2"
        />
      </div>
    </div>
  );
};

export default Form07Company;
