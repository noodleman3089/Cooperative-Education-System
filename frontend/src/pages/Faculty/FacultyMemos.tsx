import React from 'react';
import EmptyState from '../../components/ui/EmptyState';
import { Clock } from 'lucide-react';

const FacultyMemos: React.FC = () => {
  return (
    <div className="space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">บันทึกข้อความนักศึกษา</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          ติดตามบันทึกข้อความและคำร้องกรณีพิเศษของนักศึกษา
        </p>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 p-6">
        <EmptyState
          icon={Clock}
          title="กำลังทำ"
          description="ระบบบันทึกข้อความนักศึกษากำลังอยู่ระหว่างการพัฒนา"
        />
      </div>
    </div>
  );
};

export default FacultyMemos;
