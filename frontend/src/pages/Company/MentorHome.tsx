import React from 'react';
import EmptyState from '../../components/ui/EmptyState';

const MentorHome: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          รอคุณรับรอง
        </h1>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          งานของพี่เลี้ยงคือ “อ่านแล้วเซ็น” — ทุกอย่างที่ต้องเซ็นอยู่ในรายการเดียวนี้ ไล่จากบนลงล่างได้เลย
        </p>
      </div>

      <div data-testid="mentor-queue" className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <EmptyState
          title="ยังไม่มีรายการที่รอดำเนินการ"
          description="เมื่อนักศึกษาในความดูแลส่งบันทึก แผนงาน หรือรายงานฉบับร่าง รายการจะปรากฏที่นี่"
        />
      </div>
    </div>
  );
};

export default MentorHome;
