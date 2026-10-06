import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, AlertCircle, FileText } from 'lucide-react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { IntentForm } from '../../types/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import { intentDisplayStatus, getIntentStage, type DeptHeadIntentStage } from '../../utils/intentStatus';
import { formatThaiDate } from '../../utils/thaiDate';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';

const DEAD_INTENT_STATUSES = ['rejected', 'company_rejected', 'superseded'];

const studentDisplayName = (s: { first_name?: string | null; last_name?: string | null; student_code?: string }): string =>
  [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.student_code || 'ไม่ระบุชื่อ';

const formatSubmitDate = (d?: string | null): string => {
  if (!d) return '—';
  try {
    return formatThaiDate(d.slice(0, 10));
  } catch {
    return d;
  }
};

const PetitionTracking: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [is403Error, setIs403Error] = useState(false);

  const [searchText, setSearchText] = useState('');
  const activeStageParam = searchParams.get('stage') as DeptHeadIntentStage | null;
  const activeStage = activeStageParam && ['paper', 'staff', 'dean', 'company', 'accepted'].includes(activeStageParam)
    ? activeStageParam
    : 'all';

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);

      // GET /intents ดึงรายการทั้งสาขาของผู้ใช้
      // ⛔ ปฏิบัติตามกฎ fail-closed 5.1 ไม่ดักจับเป็น array ว่างเปล่า
      const res = (await api.get('/intents')) as IntentForm[] | null;
      setIntents(res || []);
      // ล้างแถบเฉพาะเมื่อโหลดสำเร็จ — ล้างก่อนยิงทำให้แถบ error หายเองทุกรอบ poll
      setError(null);
      setIs403Error(false);
    } catch (err: unknown) {
      console.error('Failed to load petition tracking data:', err);
      if (getErrorStatus(err) === 403) {
        setIs403Error(true);
      } else if (!isBackground) {
        setError(getErrorMessage(err, 'ไม่สามารถเรียกข้อมูลคำร้องใบความจำนงในสาขาวิชาได้'));
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  // ใบที่ยังมีชีวิตอยู่ (ตัด rejected และ company_rejected ออก)
  const liveIntents = useMemo(() => {
    return intents.filter(i => !DEAD_INTENT_STATUSES.includes(i.status));
  }, [intents]);

  // ตัวนับของแต่ละ stage (คำนวณจากฟังก์ชันเดียว getIntentStage)
  const stageCounts = useMemo(() => {
    const counts: Record<DeptHeadIntentStage, number> = {
      paper: 0,
      staff: 0,
      dean: 0,
      company: 0,
      accepted: 0,
      other: 0,
    };
    liveIntents.forEach(i => {
      const stage = getIntentStage(i.status, i.cover_letter_status);
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return counts;
  }, [liveIntents]);

  const handleStageSelect = (stage: 'all' | DeptHeadIntentStage) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (stage === 'all') {
        next.delete('stage');
      } else {
        next.set('stage', stage);
      }
      return next;
    });
  };

  // กรองตามคำค้นหาและ stage ที่เลือก
  const filteredIntents = useMemo(() => {
    return liveIntents.filter(intent => {
      const stage = getIntentStage(intent.status, intent.cover_letter_status);
      if (activeStage !== 'all' && stage !== activeStage) {
        return false;
      }

      if (searchText.trim()) {
        const query = searchText.trim().toLowerCase();
        const haystack = [
          intent.first_name,
          intent.last_name,
          intent.student_code,
          intent.company_name_th,
        ].filter(Boolean).join(' ').toLowerCase();

        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [liveIntents, activeStage, searchText]);

  const handleReview = (formId: number) => {
    window.dispatchEvent(new CustomEvent('open-intent-review', { detail: formId }));
  };

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dept_head', 'approval')} />;
  }

  // 403 Forbidden: ไม่มีโปรไฟล์บุคลากร (SEC-06)
  if (is403Error) {
    return (
      <div className="space-y-6 page-enter">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ติดตามคำร้อง (เอกสารหมายเลข 1)
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            การลงนาม “อนุญาต / ไม่อนุญาต” ของหัวหน้าสาขาวิชาอยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น — <strong className="font-bold text-gray-800 dark:text-gray-200">หน้านี้ไม่มีปุ่มอนุมัติหรือตีกลับ</strong> เจ้าหน้าที่เป็นคนเดียวที่รับคำร้องในระบบ
          </p>
        </div>

        <div className="rounded-2xl border border-red-200 bg-white p-8 text-center dark:border-red-900/50 dark:bg-gray-900">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-red-600 dark:text-red-400">
            ไม่พบข้อมูลสาขาวิชาที่ท่านสังกัด
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
            กรุณาติดต่อเจ้าหน้าที่เพื่อตั้งค่าโปรไฟล์บุคลากร · ⛔ ห้ามแสดงเป็น “ยังไม่มีคำร้อง”
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 page-enter">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          ติดตามคำร้อง (เอกสารหมายเลข 1)
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          การลงนาม “อนุญาต / ไม่อนุญาต” ของหัวหน้าสาขาวิชาอยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น — <strong className="font-bold text-gray-800 dark:text-gray-200">หน้านี้ไม่มีปุ่มอนุมัติหรือตีกลับ</strong> เจ้าหน้าที่เป็นคนเดียวที่รับคำร้องในระบบ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />

      {/* ── Main Table Card ── */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 overflow-hidden shadow-xs">
        {/* Filter and Search Bar */}
        <div className="p-4 sm:p-5 flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-800 flex-wrap">
          <div className="relative w-full sm:w-90">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600 dark:text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="ค้นหาชื่อ รหัส หรือสถานประกอบการ"
              className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-4 text-sm text-gray-900 focus:border-brand-blue focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="petition-stage-all"
              onClick={() => handleStageSelect('all')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                activeStage === 'all'
                  ? 'bg-blue-900 text-white dark:bg-blue-600 dark:text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              ทั้งหมด {liveIntents.length}
            </button>

            <button
              type="button"
              data-testid="petition-stage-paper"
              onClick={() => handleStageSelect('paper')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                activeStage === 'paper'
                  ? 'bg-blue-900 text-white dark:bg-blue-600 dark:text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              รอลงนามบนกระดาษ {stageCounts.paper}
            </button>

            <button
              type="button"
              data-testid="petition-stage-staff"
              onClick={() => handleStageSelect('staff')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                activeStage === 'staff'
                  ? 'bg-blue-900 text-white dark:bg-blue-600 dark:text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              ค้างที่เจ้าหน้าที่ {stageCounts.staff}
            </button>

            <button
              type="button"
              data-testid="petition-stage-dean"
              onClick={() => handleStageSelect('dean')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                activeStage === 'dean'
                  ? 'bg-blue-900 text-white dark:bg-blue-600 dark:text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              ค้างที่คณบดี {stageCounts.dean}
            </button>

            <button
              type="button"
              data-testid="petition-stage-company"
              onClick={() => handleStageSelect('company')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                activeStage === 'company'
                  ? 'bg-blue-900 text-white dark:bg-blue-600 dark:text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              รอบริษัทตอบ {stageCounts.company}
            </button>

            <button
              type="button"
              data-testid="petition-stage-accepted"
              onClick={() => handleStageSelect('accepted')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                activeStage === 'accepted'
                  ? 'bg-blue-900 text-white dark:bg-blue-600 dark:text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              ตอบรับแล้ว {stageCounts.accepted}
            </button>
          </div>
        </div>

        {/* Table Content */}
        {filteredIntents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:bg-gray-800/60 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-4 py-3 font-bold">นักศึกษา</th>
                  <th className="px-4 py-3 font-bold">สถานประกอบการที่ขอ</th>
                  <th className="px-4 py-3 font-bold">ตอนนี้อยู่ที่</th>
                  <th className="px-4 py-3 font-bold">ผู้ลงนามที่เจ้าหน้าที่บันทึก</th>
                  <th className="px-4 py-3 font-bold text-right">รายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredIntents.map((intent) => {
                  const stage = getIntentStage(intent.status, intent.cover_letter_status);
                  const hasSigner = Boolean(intent.advisor_signer_name || intent.dept_head_signer_name);

                  return (
                    <tr
                      key={intent.form_id}
                      data-testid={`petition-row-${intent.form_id}`}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors"
                    >
                      <td className="px-4 py-3.5 align-top">
                        <span className="block text-sm font-bold text-gray-900 dark:text-gray-100">
                          {studentDisplayName(intent)}
                        </span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          {intent.student_code}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 align-top text-gray-800 dark:text-gray-200">
                        <span className="block font-medium">
                          {intent.company_name_th || '–'}
                        </span>
                        {intent.submitted_late && (
                          <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5 font-medium">
                            ช่วงผ่อนผัน
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <StatusBadge
                          status={intentDisplayStatus(intent.status, intent.cover_letter_status)}
                          domain="intent"
                        />
                        {intent.officer_document_no && (
                          <span className="block text-xs text-gray-600 dark:text-gray-400 mt-1">
                            ที่ {intent.officer_document_no}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top text-gray-700 dark:text-gray-300">
                        {hasSigner ? (
                          <div className="space-y-0.5">
                            {intent.advisor_signer_name && (
                              <div>
                                ที่ปรึกษา {intent.advisor_signer_name}
                                {intent.advisor_signed_date ? ` · ${formatSubmitDate(intent.advisor_signed_date)}` : ''}
                              </div>
                            )}
                            {intent.dept_head_signer_name && (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                หัวหน้าสาขา {intent.dept_head_signer_name}
                                {intent.dept_head_signed_date ? ` · ${formatSubmitDate(intent.dept_head_signed_date)}` : ''}
                              </div>
                            )}
                          </div>
                        ) : stage === 'paper' ? (
                          <span className="text-gray-600 dark:text-gray-400">—</span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">บันทึกตอนเจ้าหน้าที่รับคำร้อง</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`petition-review-${intent.form_id}`}
                          onClick={() => handleReview(intent.form_id)}
                          className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                          ตรวจทาน
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : liveIntents.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-brand-blue dark:text-blue-400 mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
              ยังไม่มีนักศึกษาในสาขายื่นคำร้อง
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 max-w-md leading-relaxed">
              นักศึกษายื่นคำร้อง → ลงนามบนกระดาษ → เจ้าหน้าที่รับคำร้อง
            </p>
          </div>
        ) : (
          <div className="p-10 text-center text-xs text-gray-600 dark:text-gray-400">
            ไม่พบคำร้องที่ตรงกับเงื่อนไขการค้นหาหรือตัวกรองที่เลือก
          </div>
        )}

        {/* Footer Note */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 dark:bg-gray-900 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
          คำร้องที่ถูกตีกลับหรือบริษัทปฏิเสธ ไม่อยู่ในรายการนี้ — นักศึกษายื่นใหม่ได้
        </div>
      </div>
    </div>
  );
};

export default PetitionTracking;
