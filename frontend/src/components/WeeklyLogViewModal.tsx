import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Calendar, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';

interface WeeklyLogItem {
  weekly_log_id: number;
  week_number: number;
  achievements: string;
  problems: string | null;
  submitted_at: string;
}

interface WeeklyLogViewModalProps {
  isOpen: boolean;
  studentId: number | null;
  studentName?: string;
  studentCode?: string;
  onClose: () => void;
}

const WeeklyLogViewModal: React.FC<WeeklyLogViewModalProps> = ({
  isOpen,
  studentId,
  studentName,
  studentCode,
  onClose,
}) => {
  const [logs, setLogs] = useState<WeeklyLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTabWeek, setActiveTabWeek] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && studentId) {
      fetchStudentLogs(studentId);
    } else {
      setLogs([]);
      setActiveTabWeek(null);
    }
  }, [isOpen, studentId]);

  const fetchStudentLogs = async (id: number) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/weekly-logs/student/${id}`);
      const fetchedLogs: WeeklyLogItem[] = res?.data || [];
      setLogs(fetchedLogs);

      if (fetchedLogs.length > 0) {
        // Default to latest submitted week
        setActiveTabWeek(fetchedLogs[fetchedLogs.length - 1].week_number);
      } else {
        setActiveTabWeek(1);
      }
    } catch (err) {
      console.error('Failed to fetch student weekly logs:', err);
      setError('ไม่สามารถโหลดข้อมูลบันทึกรายสัปดาห์ของนักศึกษาได้');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const submittedWeeksCount = logs.length;
  const progressPercent = Math.round((submittedWeeksCount / 16) * 100);

  const activeLog = logs.find((l) => l.week_number === activeTabWeek);

  return (
    <Modal
      onClose={onClose}
      size="3xl"
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-brand-blue shrink-0 dark:text-blue-400" />
          บันทึกการปฏิบัติงานรายสัปดาห์ (Weekly Log)
        </span>
      }
    >
      <ModalBody className="flex-1 flex flex-col gap-5 min-h-0">
        <p className="text-xs text-gray-400 shrink-0">
          นักศึกษา: <span className="font-bold text-gray-700 dark:text-gray-200">{studentName || 'ไม่ระบุชื่อ'}</span> (รหัส: <span className="font-mono">{studentCode || 'N/A'}</span>)
        </p>

        {/* Progress Bar Header */}
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex justify-between items-center text-xs mb-2">
            <span className="font-semibold text-gray-700 dark:text-gray-300">
              ความก้าวหน้าการรายงานผล (16 สัปดาห์)
            </span>
            <span className="font-bold text-brand-blue dark:text-blue-400">
              ส่งแล้ว {submittedWeeksCount} / 16 สัปดาห์ ({progressPercent}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
            <div
              className="bg-brand-blue h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>

        <AlertBanner variant="error" message={error} />

        {loading ? (
          <div className="py-12 text-center text-xs text-gray-400 animate-pulse">
            กำลังโหลดข้อมูลไดอารี่ประจำสัปดาห์...
          </div>
        ) : (
          <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden min-h-0">
            {/* Week Selector Sidebar / Pills */}
            <div className="w-full md:w-48 overflow-x-auto md:overflow-y-auto shrink-0 flex md:flex-col gap-1.5 pr-1 border-b md:border-b-0 md:border-r border-gray-100 dark:border-gray-800 pb-2 md:pb-0">
              {Array.from({ length: 16 }, (_, i) => i + 1).map((weekNum) => {
                const log = logs.find((l) => l.week_number === weekNum);
                const isSubmitted = !!log;
                const isActive = activeTabWeek === weekNum;

                return (
                  <button
                    key={weekNum}
                    type="button"
                    onClick={() => setActiveTabWeek(weekNum)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-all shrink-0 active:scale-98 ${
                      isActive
                        ? 'bg-brand-blue text-white shadow-md shadow-blue-500/10'
                        : isSubmitted
                        ? 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-900/40'
                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500'
                    }`}
                  >
                    <span>สัปดาห์ที่ {weekNum}</span>
                    {isSubmitted ? (
                      <CheckCircle2 className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-green-600 dark:text-green-400'}`} />
                    ) : (
                      <span className="text-xs opacity-60">ยังไม่ส่ง</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Active Week Content Viewer */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {activeLog ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 bg-brand-blue text-white rounded-lg text-xs font-bold">
                        สัปดาห์ที่ {activeLog.week_number}
                      </span>
                      <span className="text-xs text-gray-400 flex items-center gap-1 font-mono">
                        <Calendar className="h-3.5 w-3.5" />
                        ยื่นส่งเมื่อ: {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activeLog.submitted_at))}
                      </span>
                    </div>
                  </div>

                  {/* Achievements */}
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-2">
                    <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ผลงานและสิ่งที่ปฏิบัติได้ในสัปดาห์นี้ (Achievements)
                    </h4>
                    <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                      {activeLog.achievements || 'ไม่มีรายละเอียด'}
                    </p>
                  </div>

                  {/* Problems / Obstacles */}
                  <div className="bg-amber-50/50 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/40 space-y-2">
                    <h4 className="text-xs font-bold text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      ปัญหา อุปสรรค และแนวทางแก้ไข (Problems & Solutions)
                    </h4>
                    <p className="text-xs text-amber-900/80 dark:text-amber-300 leading-relaxed whitespace-pre-line">
                      {activeLog.problems || 'ไม่มีปัญหาหรืออุปสรรคที่พบบันทึกไว้'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-xs text-gray-400 border border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
                  นักศึกษายังไม่ได้บันทึกข้อมูลผลงานสำหรับ สัปดาห์ที่ {activeTabWeek}
                </div>
              )}
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          ปิดหน้าต่าง
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default WeeklyLogViewModal;
