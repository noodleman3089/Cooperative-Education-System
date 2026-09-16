import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import EmptyState from '../../components/ui/EmptyState';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface UnassignedItem {
  student_id: number;
  student_code: string;
  full_name: string;
  missing: ('advisor' | 'supervisor')[];
}

interface DeptHeadHomeData {
  today: string;
  major: {
    major_id: number;
    major_name_th: string;
  } | null;
  students_total: number;
  unassigned: {
    students_affected: number;
    missing_advisor: number;
    missing_supervisor: number;
    items: UnassignedItem[];
  };
  pipeline: {
    not_submitted: number;
    paper: number;
    staff: number;
    dean: number;
    company: number;
    accepted: number;
  };
  evaluation: {
    placed: number;
    missing_15: number;
    missing_16: number;
    both_done: number;
  };
}

function formatThaiDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

const DeptHeadHome: React.FC = () => {
  const [, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DeptHeadHomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [is403, setIs403] = useState(false);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      setIs403(false);
      const res = await api.get('/faculty/home/dept-head');
      setData(res);
    } catch (err: unknown) {
      console.error('Failed to load dept head home data:', err);
      const errorObj = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const status = errorObj.response?.status;
      const message = errorObj.response?.data?.message || errorObj.message || 'เกิดข้อผิดพลาดขณะโหลดข้อมูลหน้าแรกของหัวหน้าสาขาวิชา';
      if (status === 403) {
        setIs403(true);
        setError(message);
      } else {
        setError(message);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dept_head', 'dashboard')} />;
  }

  if (is403) {
    return (
      <div className="space-y-6 page-enter">
        <EmptyState
          icon={AlertCircle}
          title="ไม่มีสิทธิ์เข้าถึงข้อมูลสาขาวิชา"
          description={error || 'บัญชีของคุณยังไม่ได้ผูกกับสาขาวิชาในฐานะหัวหน้าสาขา กรุณาติดต่อผู้ดูแลระบบหรือเจ้าหน้าที่'}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6 page-enter">
        <AlertBanner variant="error" message={error || 'ไม่สามารถโหลดข้อมูลหน้าแรกได้'} />
      </div>
    );
  }

  const { major, students_total, unassigned, pipeline, evaluation, today } = data;
  const remainingUnassignedCount = Math.max(0, unassigned.students_affected - unassigned.items.length);

  return (
    <div className="space-y-6 page-enter pb-8">
      {/* ══ Header ══ */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ภาพรวมสาขาวิชา
          </h1>
          <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
            {major?.major_name_th || 'สาขาวิชา'} · นักศึกษา {students_total} คน · งานที่ระบบรอให้คุณกดมีอย่างเดียวคือจัดสรรอาจารย์ ที่เหลือคือการติดตาม
          </p>
        </div>
        {today && (
          <span className="text-[13px] text-gray-600 dark:text-gray-400 shrink-0">
            วันนี้ {formatThaiDate(today)}
          </span>
        )}
      </div>

      {/* ══ การ์ดงานหลัก — งานเดียวที่รอคุณกด ══ */}
      {unassigned.students_affected > 0 ? (
        <div
          data-testid="dept-home-assign-card"
          data-count={unassigned.students_affected}
          className="rounded-2xl border border-blue-200 dark:border-blue-800 overflow-hidden shadow-sm bg-gradient-to-b from-blue-50 to-white dark:from-blue-950/40 dark:to-gray-900"
        >
          <div className="p-6 sm:px-7 sm:py-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-col gap-1.5 max-w-2xl">
              <span className="text-[13px] font-bold text-blue-700 dark:text-blue-400">รอคุณ</span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white leading-snug">
                นักศึกษา {unassigned.students_affected} คนยังไม่มีอาจารย์ครบสองตำแหน่ง
              </h2>
              <span className="text-sm sm:text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
                {unassigned.missing_advisor} คนยังไม่มีอาจารย์ที่ปรึกษา · {unassigned.missing_supervisor} คนยังไม่มีอาจารย์นิเทศ — อาจารย์ของนักศึกษากลุ่มนี้จะไม่เห็นโครงร่าง บันทึก และนัดหมายนิเทศของเขา
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({ menu: 'assignment', filter: 'incomplete' })}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-[15px] text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors shadow-sm shrink-0 border-none cursor-pointer"
            >
              จัดสรรอาจารย์ {unassigned.students_affected} คน
            </button>
          </div>
        </div>
      ) : (
        <div
          data-testid="dept-home-assign-card"
          data-count={0}
          className="rounded-2xl border border-emerald-200 dark:border-emerald-800 overflow-hidden shadow-sm bg-gradient-to-b from-emerald-50 to-white dark:from-emerald-950/40 dark:to-gray-900 p-6 sm:px-7 sm:py-6 flex items-center gap-4"
        >
          <div className="p-2 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 shrink-0">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">เรียบร้อย</span>
            <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">
              นักศึกษาทุกคนมีอาจารย์ครบแล้ว
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              นักศึกษาทุกคนในสาขาวิชามีทั้งอาจารย์ที่ปรึกษาและอาจารย์นิเทศครบถ้วนแล้ว
            </p>
          </div>
        </div>
      )}

      {/* ══ เส้นทางคำร้องของสาขา — อ่านอย่างเดียว ไม่มีปุ่ม ══ */}
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-baseline">
          <h2 className="text-[19px] font-bold text-gray-900 dark:text-white">
            คำร้องเอกสารหมายเลข 1 ของสาขาอยู่ตรงไหน
          </h2>
          <button
            type="button"
            onClick={() => setSearchParams({ menu: 'approval' })}
            className="text-[13px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors bg-transparent border-none p-0 cursor-pointer"
          >
            เปิดตารางติดตาม
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. รอลงนามบนกระดาษ */}
          <button
            type="button"
            data-testid="dept-home-stage-paper"
            data-count={pipeline.paper}
            onClick={() => setSearchParams({ menu: 'approval', stage: 'paper' })}
            className="rounded-[14px] p-[14px_16px] flex flex-col gap-1 box-border bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-all text-left shadow-sm"
          >
            <span className="text-[13px] font-bold text-gray-700 dark:text-gray-200">
              รอลงนามบนกระดาษ
            </span>
            <span className="text-[28px] leading-[1.2] font-extrabold text-gray-900 dark:text-white">
              {pipeline.paper}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              นักศึกษาจะนำมาให้คุณเซ็น
            </span>
          </button>

          {/* 2. ค้างที่เจ้าหน้าที่ (เทาเส้นประ ไม่มีปุ่ม) */}
          <button
            type="button"
            data-testid="dept-home-stage-staff"
            data-count={pipeline.staff}
            onClick={() => setSearchParams({ menu: 'approval', stage: 'staff' })}
            className="rounded-[14px] p-[14px_16px] flex flex-col gap-1 box-border bg-gray-50 dark:bg-gray-800/40 border border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-all text-left"
          >
            <span className="text-[13px] font-bold text-gray-600 dark:text-gray-400">
              ค้างที่เจ้าหน้าที่
            </span>
            <span className="text-[28px] leading-[1.2] font-extrabold text-gray-600 dark:text-gray-400">
              {pipeline.staff}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              อัปโหลดแล้ว รอรับคำร้อง
            </span>
          </button>

          {/* 3. ค้างที่คณบดี (เทาเส้นประ ไม่มีปุ่ม) */}
          <button
            type="button"
            data-testid="dept-home-stage-dean"
            data-count={pipeline.dean}
            onClick={() => setSearchParams({ menu: 'approval', stage: 'dean' })}
            className="rounded-[14px] p-[14px_16px] flex flex-col gap-1 box-border bg-gray-50 dark:bg-gray-800/40 border border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-all text-left"
          >
            <span className="text-[13px] font-bold text-gray-600 dark:text-gray-400">
              ค้างที่คณบดี
            </span>
            <span className="text-[28px] leading-[1.2] font-extrabold text-gray-600 dark:text-gray-400">
              {pipeline.dean}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              หนังสือขอความอนุเคราะห์
            </span>
          </button>

          {/* 4. รอบริษัทตอบ (เทาเส้นประ ไม่มีปุ่ม) */}
          <button
            type="button"
            data-testid="dept-home-stage-company"
            data-count={pipeline.company}
            onClick={() => setSearchParams({ menu: 'approval', stage: 'company' })}
            className="rounded-[14px] p-[14px_16px] flex flex-col gap-1 box-border bg-gray-50 dark:bg-gray-800/40 border border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-all text-left"
          >
            <span className="text-[13px] font-bold text-gray-600 dark:text-gray-400">
              รอบริษัทตอบ
            </span>
            <span className="text-[28px] leading-[1.2] font-extrabold text-gray-600 dark:text-gray-400">
              {pipeline.company}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              หนังสือออกไปแล้ว
            </span>
          </button>

          {/* 5. ได้ที่ฝึกแล้ว */}
          <button
            type="button"
            data-testid="dept-home-stage-accepted"
            data-count={pipeline.accepted}
            onClick={() => setSearchParams({ menu: 'approval', stage: 'accepted' })}
            className="rounded-[14px] p-[14px_16px] flex flex-col gap-1 box-border bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-500 transition-all text-left shadow-sm"
          >
            <span className="text-[13px] font-bold text-gray-700 dark:text-gray-200">
              ได้ที่ฝึกแล้ว
            </span>
            <span className="text-[28px] leading-[1.2] font-extrabold text-emerald-700 dark:text-emerald-400">
              {pipeline.accepted}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              บริษัทตอบรับ
            </span>
          </button>
        </div>

        <span className="text-xs text-gray-600 dark:text-gray-400">
          กองสีเทาเส้นประ = ค้างที่คนอื่น ไม่มีปุ่มโดยตั้งใจ · ยังไม่ยื่นเลย {pipeline.not_submitted} คน
        </span>
      </div>

      {/* ══ สองการ์ดล่าง ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] items-start">
        {/* การ์ดซ้าย: ยังไม่ได้จัดสรรอาจารย์ */}
        <div
          data-testid="dept-home-unassigned"
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden"
        >
          <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              ยังไม่ได้จัดสรรอาจารย์
            </h3>
            <span className="text-[13px] text-gray-600 dark:text-gray-400">
              {unassigned.students_affected} คน
            </span>
          </div>

          {unassigned.items.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-600 dark:text-gray-400">
              นักศึกษาทุกคนมีอาจารย์ครบแล้ว
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {unassigned.items.map((item) => (
                  <tr key={item.student_id}>
                    <td className="p-[14px_16px] text-[13px] text-gray-700 dark:text-gray-300 align-top">
                      <span className="block text-[15px] font-bold text-gray-900 dark:text-white">
                        {item.full_name}
                      </span>
                      <span className="block text-gray-600 dark:text-gray-400 text-xs mt-0.5">
                        {item.student_code}
                      </span>
                    </td>
                    <td className="p-[14px_16px] text-[13px] align-top text-right sm:text-left">
                      <div className="flex flex-wrap gap-1.5 justify-end sm:justify-start">
                        {item.missing?.includes('advisor') && (
                          <span className="inline-block px-2.5 py-1 rounded-full text-[13px] font-bold border whitespace-nowrap bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                            ไม่มีที่ปรึกษา
                          </span>
                        )}
                        {item.missing?.includes('supervisor') && (
                          <span className="inline-block px-2.5 py-1 rounded-full text-[13px] font-bold border whitespace-nowrap bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                            ไม่มีผู้นิเทศ
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="p-[12px_20px] border-t border-gray-100 dark:border-gray-800 text-[13px] text-gray-600 dark:text-gray-400 flex items-center justify-between">
            <span>
              {remainingUnassignedCount > 0
                ? `อีก ${remainingUnassignedCount} คน · `
                : ''}
              ดูทั้งหมดที่ “จัดสรรอาจารย์”
            </span>
            <button
              type="button"
              onClick={() => setSearchParams({ menu: 'assignment', filter: 'incomplete' })}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold text-xs border-none bg-transparent cursor-pointer p-0"
            >
              ไปหน้าจัดสรร →
            </button>
          </div>
        </div>

        {/* การ์ดขวา: เอกสารปลายภาคของสาขา */}
        <div
          data-testid="dept-home-evaluation"
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-[18px_20px] flex flex-col gap-3"
        >
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              เอกสารปลายภาคของสาขา
            </h3>
            <button
              type="button"
              onClick={() => setSearchParams({ menu: 'final_progress' })}
              className="text-[13px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors bg-transparent border-none p-0 cursor-pointer"
            >
              ติดตามเอกสาร & ผลประเมิน
            </button>
          </div>

          {evaluation.placed === 0 ? (
            <div className="p-[18px] border border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/40 flex flex-col gap-1 items-center text-center my-auto">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                ยังไม่มีนักศึกษาได้ที่ฝึก
              </span>
              <span className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
                ตัวเลขใบประเมิน สหกิจ 15/16 จะขึ้นหลังนักศึกษาได้ที่ฝึกงานเรียบร้อยแล้ว
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700">
                <div className="flex flex-col">
                  <span className="text-[13px] text-gray-600 dark:text-gray-400 font-medium">
                    นักศึกษาที่ได้ที่ฝึกแล้ว
                  </span>
                  <span className="text-xl font-bold text-gray-900 dark:text-white">
                    {evaluation.placed} คน
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                    ครบทั้ง 2 ใบ
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {evaluation.both_done} คน
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 flex flex-col gap-0.5">
                  <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                    ยังไม่ส่ง สหกิจ 15
                  </span>
                  <span className="text-lg font-bold text-gray-800 dark:text-gray-200">
                    {evaluation.missing_15} <span className="text-xs font-normal text-gray-600 dark:text-gray-400">คน</span>
                  </span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">
                    แบบประเมินผลการปฏิบัติงาน
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 flex flex-col gap-0.5">
                  <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                    ยังไม่ส่ง สหกิจ 16
                  </span>
                  <span className="text-lg font-bold text-gray-800 dark:text-gray-200">
                    {evaluation.missing_16} <span className="text-xs font-normal text-gray-600 dark:text-gray-400">คน</span>
                  </span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">
                    แบบประเมินรายงาน
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeptHeadHome;
