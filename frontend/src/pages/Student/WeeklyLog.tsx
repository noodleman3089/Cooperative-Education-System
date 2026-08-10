import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import { Calendar, CheckCircle, Save, RefreshCw } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';

interface WeeklyLog {
  weekly_log_id: number;
  week_number: number;
  achievements: string;
  problems: string | null;
  submitted_at: string;
}

const WeeklyLog: React.FC = () => {
  const auth = useContext(AuthContext);
  const [logs, setLogs] = useState<WeeklyLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [achievements, setAchievements] = useState<string>('');
  const [problems, setProblems] = useState<string>('');

  const fetchLogs = async (controller?: AbortController) => {
    if (!auth?.user) return;
    try {
      setLoading(true);
      setError(null);
      const result = await api.get(`/weekly-logs/student/${auth.user.userId}`, { 
        signal: controller?.signal 
      });
      setLogs(result.data || []);
      
      // Auto-select next available week if possible
      const maxWeek = result.data?.reduce((max: number, log: WeeklyLog) => Math.max(max, log.week_number), 0) || 0;
      if (maxWeek < 16) {
        setSelectedWeek(maxWeek + 1);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchLogs(controller);
    return () => controller.abort();
  }, [auth?.user]);

  // When selectedWeek changes, populate form if log already exists
  useEffect(() => {
    const existingLog = logs.find(log => log.week_number === selectedWeek);
    if (existingLog) {
      setAchievements(existingLog.achievements);
      setProblems(existingLog.problems || '');
    } else {
      setAchievements('');
      setProblems('');
    }
  }, [selectedWeek, logs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!achievements.trim()) {
      setError('กรุณากรอกผลการปฏิบัติงาน');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await api.post('/weekly-logs', {
        week_number: selectedWeek,
        achievements,
        problems
      });
      
      setSuccess('บันทึกข้อมูลสำเร็จ');
      await fetchLogs(); // Refresh list
    } catch (err: any) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row gap-6">
        
        {/* Left Column: Form */}
        <div className="w-full md:w-1/2 flex flex-col gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8 flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">บันทึกการปฏิบัติงานรายสัปดาห์</h1>
            <p className="text-gray-500 dark:text-gray-400 mb-8">บันทึกผลการทำงานและปัญหาที่พบในแต่ละสัปดาห์</p>

            <AlertBanner variant="error" message={error} className="mb-6" />
            <AlertBanner variant="success" message={success} className="mb-6" />

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">สัปดาห์ที่</label>
                <select
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all"
                >
                  {Array.from({ length: 16 }, (_, i) => i + 1).map(week => (
                    <option key={week} value={week}>สัปดาห์ที่ {week}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ผลการปฏิบัติงาน (Achievements) <span className="text-red-500">*</span></label>
                <textarea
                  value={achievements}
                  onChange={(e) => setAchievements(e.target.value)}
                  rows={5}
                  placeholder="อธิบายงานที่ได้รับมอบหมายและผลลัพธ์ที่ได้..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all resize-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ปัญหาและอุปสรรค (Problems/Issues)</label>
                <textarea
                  value={problems}
                  onChange={(e) => setProblems(e.target.value)}
                  rows={3}
                  placeholder="อธิบายปัญหาที่พบและวิธีการแก้ไข (ถ้ามี)..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-medium transition-all shadow-sm
                  ${submitting 
                    ? 'bg-brand-blue/70 text-white cursor-wait' 
                    : 'bg-brand-blue hover:bg-blue-600 text-white hover:shadow-md hover:shadow-blue-500/20 active:scale-[0.98]'}`}
              >
                {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                <span>{submitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: History */}
        <div className="w-full md:w-1/2 flex flex-col gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8 flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand-blue dark:text-blue-400" />
              ประวัติการบันทึก
            </h2>

            {loading ? (
              <div className="py-12 flex justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
              </div>
            ) : logs.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-800/50">
                <CheckCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">ยังไม่มีประวัติการบันทึก</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {logs.map((log) => (
                  <div 
                    key={log.weekly_log_id} 
                    onClick={() => setSelectedWeek(log.week_number)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      selectedWeek === log.week_number
                        ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
                        : 'bg-white border-gray-100 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-gray-900 dark:text-white">สัปดาห์ที่ {log.week_number}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(log.submitted_at).toLocaleDateString('th-TH')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                      {log.achievements}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default WeeklyLog;
