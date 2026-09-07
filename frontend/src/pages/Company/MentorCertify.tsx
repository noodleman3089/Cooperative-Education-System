import React from 'react';
import EmptyState from '../../components/ui/EmptyState';

const MentorCertify: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          รับรองงานนักศึกษา
        </h1>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          รับรองบันทึกการปฏิบัติงาน แผนปฏิบัติงาน และตรวจร่างรายงาน
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <EmptyState
          title="หน้ารับรองงานนักศึกษา"
          description="กำลังจัดเตรียมหน้าจอรับรองงานนักศึกษา (3 แท็บ)"
        />
      </div>
    </div>
  );
};

export default MentorCertify;
