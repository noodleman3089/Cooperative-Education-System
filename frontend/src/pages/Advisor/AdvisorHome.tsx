import React, { useState, useContext, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import type { IntentForm } from '../../types/api';
import { FileText, Calendar, ChevronRight } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import StatusBadge from '../../components/ui/StatusBadge';
import { intentDisplayStatus } from '../../utils/intentStatus';
import { formatThaiDate } from '../../utils/thaiDate';
import { AuthContext } from '../../context/AuthContext';
import { getErrorMessage } from '../../utils/errors';

export interface TileItem {
  ref_id: number | null;
  student_id: number;
  student_code: string;
  full_name: string;
  company_name_th: string | null;
  detail: string | null;
  since: string | null;
  days: number | null;
  visit_number?: number;
}

export interface TileData {
  count: number;
  note: string | null;
  items: TileItem[];
}

export interface AdvisorHomePayload {
  today: string;
  view: 'advisor' | 'supervisor';
  tiles: Record<string, TileData>;
  paper_pending_major?: number;
}

interface AdvisorHomeProps {
  view?: 'advisor' | 'supervisor';
}

const intentStudentName = (intent?: IntentForm | null): string =>
  [intent?.first_name, intent?.last_name].filter(Boolean).join(' ').trim()
  || intent?.student_name
  || intent?.student_code
  || 'ไม่ระบุชื่อ';

const AdvisorHome: React.FC<AdvisorHomeProps> = ({ view: propView }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useContext(AuthContext);

  const roleParam = searchParams.get('role');
  const currentView: 'advisor' | 'supervisor' =
    propView || (roleParam === 'supervisor' ? 'supervisor' : 'advisor');

  const [dashboardPayload, setDashboardPayload] = useState<AdvisorHomePayload | null>(null);
  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [showIntentsTable, setShowIntentsTable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Order of tiles per spec section 3.2
  const advisorTileOrder = ['outline', 'report', 'confirmation'];
  const supervisorTileOrder = ['reschedule', 'unrecorded_visit', 'no_appointment'];
  const tileOrder = currentView === 'advisor' ? advisorTileOrder : supervisorTileOrder;

  // Determine active tile kind: URL param -> first tile with count > 0 -> fallback first tile
  const tileParam = searchParams.get('tile');
  const activeTileKind = (() => {
    if (tileParam && tileOrder.includes(tileParam)) {
      return tileParam;
    }
    if (dashboardPayload?.tiles) {
      const firstNonZero = tileOrder.find(
        (k) => (dashboardPayload.tiles[k]?.count ?? 0) > 0
      );
      if (firstNonZero) return firstNonZero;
    }
    return tileOrder[0];
  })();

  const loadData = useCallback(
    async (isBackground = false) => {
      try {
        if (!isBackground) setLoading(true);

        // ยิงซ้ำกับ Navbar.tsx โดยตั้งใจ — กระดิ่งต้องมีข้อมูลของตัวเองทุกหน้า
        // แชร์ผลกันได้ก็ต่อเมื่อมี context/store ใหม่ ซึ่งเกินขอบเขตแก้จุดนี้
        const homeRes: AdvisorHomePayload = await api.get(
          `/faculty/home/advisor?view=${currentView}`
        );
        setDashboardPayload(homeRes);
        setError(null);

        // Fetch intents list only for the advisor tracking card
        if (currentView === 'advisor') {
          try {
            const intentsRes = await api.get('/intents');
            setIntents(intentsRes || []);
          } catch (err) {
            if (!isBackground) {
              setError(getErrorMessage(err, 'โหลดรายการใบความจำนงที่ติดตามไม่ได้'));
            }
          }
        }
      } catch (err: unknown) {
        if (!isBackground) {
          setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลหน้าแรกของอาจารย์ได้ กรุณาลองใหม่อีกครั้ง'));
        }
      } finally {
        if (!isBackground) setLoading(false);
      }
    },
    [currentView]
  );

  useDashboardData(loadData, [loadData]);

  const userViews = auth?.user?.views || auth?.user?.roles || [];
  const hasBothViews = userViews.includes('advisor') && userViews.includes('supervisor');

  const formatDisplayDate = (isoStr?: string | null) => {
    if (!isoStr) return '';
    return formatThaiDate(String(isoStr).slice(0, 10));
  };

  const handleTileClick = (kind: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tile', kind);
      return next;
    });
  };

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'dashboard')} />;
  }

  const tiles = dashboardPayload?.tiles || {};
  const todayStr = dashboardPayload?.today
    ? formatThaiDate(dashboardPayload.today)
    : '';

  // Get active tile data
  const activeTileData: TileData = tiles[activeTileKind] || {
    count: 0,
    note: null,
    items: [],
  };

  // Titles and navigation targets for tiles (matching .dc.html 1:1)
  const tileMeta: Record<
    string,
    { title: string; defaultSubtitle: string; viewAllUrl: string }
  > = {
    outline: {
      title: 'โครงร่างรอเห็นชอบ',
      defaultSubtitle: 'สหกิจ 11 ที่พนักงานที่ปรึกษาเห็นชอบแล้ว เรียงตามวันที่ส่งมาถึงคุณ',
      viewAllUrl: '/dashboard?menu=report_outlines&tab=pending_advisor',
    },
    report: {
      title: 'เล่มรายงานรอตรวจรับ',
      defaultSubtitle: 'เล่มฉบับสมบูรณ์ที่ส่งเข้ามารอตรวจรับ',
      viewAllUrl: '/dashboard?menu=final_evaluation',
    },
    confirmation: {
      title: 'สหกิจ 14 รอลงนามรับรอง',
      defaultSubtitle: 'เกิดหลังตรวจรับเล่มแล้ว และนักศึกษายื่นขอ',
      viewAllUrl: '/dashboard?menu=final_evaluation',
    },
    reschedule: {
      title: 'พี่เลี้ยงขอเลื่อนนัดนิเทศ',
      defaultSubtitle: 'สหกิจ 12 · ต้องตอบรับหรือตกลงนอกระบบ',
      viewAllUrl: '/dashboard?role=supervisor&menu=supervision',
    },
    unrecorded_visit: {
      title: 'ไปนิเทศแล้ว ยังไม่บันทึก',
      defaultSubtitle: 'นัดที่คุณร่างและตกลงกันแล้ว วันนัดผ่านไปแล้ว แต่ยังไม่มีแบบบันทึกการนิเทศ (สหกิจ 13) ของครั้งนั้น',
      viewAllUrl: '/dashboard?role=supervisor&menu=supervision_record',
    },
    no_appointment: {
      title: 'ยังไม่มีนัดนิเทศเลย',
      defaultSubtitle: 'ข้อมูลประกอบ ไม่ใช่งานค้าง · เปิดดูที่นัดหมายนิเทศ',
      viewAllUrl: '/dashboard?role=supervisor&menu=supervision',
    },
  };

  const currentTileMeta = tileMeta[activeTileKind] || {
    title: activeTileKind,
    defaultSubtitle: '',
    viewAllUrl: '/dashboard',
  };

  const DEAD_INTENT_STATUSES = ['rejected', 'company_rejected'];
  const trackedIntents = intents.filter(
    (i) => !DEAD_INTENT_STATUSES.includes(i.status)
  );

  return (
    <div
      data-testid="advisor-home"
      data-view={currentView}
      className="space-y-5 page-enter pb-12"
    >
      <AlertBanner variant="error" message={error} />

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            งานที่รอมือคุณ · {currentView === 'advisor' ? 'ฝ่ายที่ปรึกษา' : 'ฝ่ายนิเทศ'}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {currentView === 'advisor'
              ? 'นักศึกษาที่คุณเป็นอาจารย์ที่ปรึกษา · กองที่เป็นศูนย์ยังแสดงอยู่เสมอ'
              : 'นักศึกษาที่หัวหน้าสาขาตั้งให้คุณนิเทศ · กองที่เป็นศูนย์ยังแสดงอยู่เสมอ'}
          </p>
        </div>
        {todayStr && (
          <span className="text-xs text-gray-600 dark:text-gray-400 shrink-0">
            วันนี้ {todayStr}
          </span>
        )}
      </div>

      {/* Cross-role banner when personnel has both views */}
      {currentView === 'advisor' && hasBothViews && (
        <div className="border border-dashed border-blue-300 bg-blue-50/50 dark:bg-blue-950/30 dark:border-blue-800 rounded-xl p-3 px-4 flex items-center gap-2.5 text-xs text-blue-900 dark:text-blue-300 shadow-xs">
          <Calendar className="w-4 h-4 text-brand-blue dark:text-blue-400 shrink-0" />
          <span>
            คุณเป็นอาจารย์นิเทศด้วย — นัดนิเทศและสหกิจ 13 อยู่ในฝ่ายนิเทศ สลับได้ที่มุมขวาบน
          </span>
        </div>
      )}

      {/* 3 Work Piles (Tiles) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {currentView === 'advisor' ? (
          <>
            {/* Tile 1: outline */}
            <button
              type="button"
              data-testid="advisor-home-tile-outline"
              data-count={tiles.outline?.count ?? 0}
              onClick={() => handleTileClick('outline')}
              className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                activeTileKind === 'outline'
                  ? 'border-2 border-brand-blue bg-white dark:bg-gray-900 shadow-sm ring-2 ring-blue-100 dark:ring-blue-950/40'
                  : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <div className="flex items-baseline justify-between w-full">
                <span
                  className={`text-xs font-bold ${
                    activeTileKind === 'outline'
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  โครงร่างรอเห็นชอบ
                </span>
                <span
                  className={`text-3xl font-extrabold leading-none ${
                    (tiles.outline?.count ?? 0) > 0
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {tiles.outline?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                {(tiles.outline?.count ?? 0) === 0 && tiles.outline?.note
                  ? tiles.outline.note
                  : 'สหกิจ 11 · พี่เลี้ยงเห็นชอบแล้ว'}
              </span>
            </button>

            {/* Tile 2: report */}
            <button
              type="button"
              data-testid="advisor-home-tile-report"
              data-count={tiles.report?.count ?? 0}
              onClick={() => handleTileClick('report')}
              className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                activeTileKind === 'report'
                  ? 'border-2 border-brand-blue bg-white dark:bg-gray-900 shadow-sm ring-2 ring-blue-100 dark:ring-blue-950/40'
                  : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <div className="flex items-baseline justify-between w-full">
                <span
                  className={`text-xs font-bold ${
                    activeTileKind === 'report'
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  เล่มรายงานรอตรวจรับ
                </span>
                <span
                  className={`text-3xl font-extrabold leading-none ${
                    (tiles.report?.count ?? 0) > 0
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {tiles.report?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                {(tiles.report?.count ?? 0) === 0 && tiles.report?.note
                  ? tiles.report.note
                  : 'เล่มฉบับสมบูรณ์ที่ส่งเข้ามารอตรวจรับ'}
              </span>
            </button>

            {/* Tile 3: confirmation */}
            <button
              type="button"
              data-testid="advisor-home-tile-confirmation"
              data-count={tiles.confirmation?.count ?? 0}
              onClick={() => handleTileClick('confirmation')}
              className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                activeTileKind === 'confirmation'
                  ? 'border-2 border-brand-blue bg-white dark:bg-gray-900 shadow-sm ring-2 ring-blue-100 dark:ring-blue-950/40'
                  : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <div className="flex items-baseline justify-between w-full">
                <span
                  className={`text-xs font-bold ${
                    activeTileKind === 'confirmation'
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  สหกิจ 14 รอลงนามรับรอง
                </span>
                <span
                  className={`text-3xl font-extrabold leading-none ${
                    (tiles.confirmation?.count ?? 0) > 0
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {tiles.confirmation?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                {(tiles.confirmation?.count ?? 0) === 0 && tiles.confirmation?.note
                  ? tiles.confirmation.note
                  : 'เกิดหลังตรวจรับเล่มแล้ว และนักศึกษายื่นขอ'}
              </span>
            </button>
          </>
        ) : (
          <>
            {/* Tile 1: reschedule */}
            <button
              type="button"
              data-testid="advisor-home-tile-reschedule"
              data-count={tiles.reschedule?.count ?? 0}
              onClick={() => handleTileClick('reschedule')}
              className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                activeTileKind === 'reschedule'
                  ? 'border-2 border-brand-blue bg-white dark:bg-gray-900 shadow-sm ring-2 ring-blue-100 dark:ring-blue-950/40'
                  : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <div className="flex items-baseline justify-between w-full">
                <span
                  className={`text-xs font-bold ${
                    activeTileKind === 'reschedule'
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  พี่เลี้ยงขอเลื่อนนัดนิเทศ
                </span>
                <span
                  className={`text-3xl font-extrabold leading-none ${
                    (tiles.reschedule?.count ?? 0) > 0
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {tiles.reschedule?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                {(tiles.reschedule?.count ?? 0) === 0 && tiles.reschedule?.note
                  ? tiles.reschedule.note
                  : 'สหกิจ 12 · ต้องตอบรับหรือตกลงนอกระบบ'}
              </span>
            </button>

            {/* Tile 2: unrecorded_visit */}
            <button
              type="button"
              data-testid="advisor-home-tile-unrecorded_visit"
              data-count={tiles.unrecorded_visit?.count ?? 0}
              onClick={() => handleTileClick('unrecorded_visit')}
              className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                activeTileKind === 'unrecorded_visit'
                  ? 'border-2 border-brand-blue bg-white dark:bg-gray-900 shadow-sm ring-2 ring-blue-100 dark:ring-blue-950/40'
                  : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <div className="flex items-baseline justify-between w-full">
                <span
                  className={`text-xs font-bold ${
                    activeTileKind === 'unrecorded_visit'
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  ไปนิเทศแล้ว ยังไม่บันทึก
                </span>
                <span
                  className={`text-3xl font-extrabold leading-none ${
                    (tiles.unrecorded_visit?.count ?? 0) > 0
                      ? 'text-brand-blue dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {tiles.unrecorded_visit?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium line-clamp-1">
                {(tiles.unrecorded_visit?.count ?? 0) === 0 && tiles.unrecorded_visit?.note
                  ? tiles.unrecorded_visit.note
                  : 'สหกิจ 13 · วันนัดผ่านไปแล้ว'}
              </span>
            </button>

            {/* Tile 3: no_appointment (Informational) */}
            <button
              type="button"
              data-testid="advisor-home-tile-no_appointment"
              data-count={tiles.no_appointment?.count ?? 0}
              onClick={() => handleTileClick('no_appointment')}
              className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 border border-dashed ${
                activeTileKind === 'no_appointment'
                  ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/20'
                  : 'border-gray-300 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 hover:bg-gray-100/60 dark:hover:bg-gray-800/70'
              }`}
            >
              <div className="flex items-baseline justify-between w-full">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
                  ยังไม่มีนัดนิเทศเลย
                </span>
                <span className="text-3xl font-extrabold leading-none text-gray-500 dark:text-gray-400">
                  {tiles.no_appointment?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
                ข้อมูลประกอบ ไม่ใช่งานค้าง · เปิดดูที่นัดหมายนิเทศ
              </span>
            </button>
          </>
        )}
      </div>

      {/* Paper banner (Advisor only) */}
      {currentView === 'advisor' &&
        (dashboardPayload?.paper_pending_major ?? 0) > 0 && (
          <div
            data-testid="advisor-home-paper-banner"
            className="card border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-2xl p-3.5 px-4.5 flex items-center gap-3 shadow-xs"
          >
            <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0" />
            <span className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              <strong className="text-gray-900 dark:text-white font-bold">
                เอกสารหมายเลข 1 ในสาขา {dashboardPayload?.paper_pending_major} ใบยังรอลงนามบนกระดาษ
              </strong>{' '}
              — นักศึกษาจะนำแบบคำร้องมาให้คุณเซ็นเอง ระบบไม่มีปุ่มอนุมัติ
            </span>
            <button
              type="button"
              onClick={() => setShowIntentsTable(!showIntentsTable)}
              className="ml-auto text-xs sm:text-sm font-semibold text-brand-blue hover:text-blue-800 dark:text-blue-400 shrink-0 cursor-pointer"
            >
              {showIntentsTable ? 'ซ่อนรายชื่อ' : 'ดูรายชื่อ'}
            </button>
          </div>
        )}

      {/* Active tile items table */}
      <div
        data-testid="advisor-home-items"
        className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden"
      >
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {currentTileMeta.title}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">
              {activeTileData.count === 0 && activeTileData.note
                ? activeTileData.note
                : currentTileMeta.defaultSubtitle}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
              {activeTileData.count} รายการ
            </span>
            {activeTileData.count > 0 && (
              <button
                type="button"
                onClick={() => navigate(currentTileMeta.viewAllUrl)}
                className="-my-3 py-3 text-xs font-bold text-brand-blue dark:text-blue-400 hover:underline flex items-center cursor-pointer"
              >
                ดูทั้งหมด <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </button>
            )}
          </div>
        </div>

        {activeTileData.items.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {activeTileData.note || 'ไม่มีรายการในกองนี้'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                  <th className="px-4 py-3 font-bold">นักศึกษา</th>
                  {currentView === 'advisor' && (
                    <th className="px-4 py-3 font-bold">หัวข้อรายงาน</th>
                  )}
                  {currentView === 'advisor' && (
                    <th className="px-4 py-3 font-bold">
                      {activeTileKind === 'outline'
                        ? 'พี่เลี้ยงเห็นชอบเมื่อ'
                        : activeTileKind === 'confirmation'
                        ? 'ยื่นขอเมื่อ'
                        : 'ส่งมาเมื่อ'}
                    </th>
                  )}
                  {currentView === 'advisor' && (
                    <th className="px-4 py-3 font-bold">บทบาทของคุณ</th>
                  )}
                  {currentView === 'supervisor' && activeTileKind !== 'no_appointment' && (
                    <th className="px-4 py-3 font-bold">ครั้งที่</th>
                  )}
                  {currentView === 'supervisor' && activeTileKind === 'reschedule' && (
                    <th className="px-4 py-3 font-bold">วันที่ขอเลื่อน</th>
                  )}
                  {currentView === 'supervisor' && activeTileKind === 'unrecorded_visit' && (
                    <th className="px-4 py-3 font-bold">วันนัด</th>
                  )}
                  {currentView === 'supervisor' && activeTileKind === 'no_appointment' && (
                    <th className="px-4 py-3 font-bold">สถานะ</th>
                  )}
                  <th className="px-4 py-3 font-bold text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {activeTileData.items.map((it, idx) => (
                  <tr
                    key={it.ref_id || idx}
                    className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="px-4 py-3 align-top">
                      <span className="font-bold text-gray-900 dark:text-white block text-[13px]">
                        {it.full_name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">
                        {it.student_code}
                        {it.company_name_th ? ` · ${it.company_name_th}` : ''}
                      </span>
                    </td>

                    {/* Advisor columns */}
                    {currentView === 'advisor' && (
                      <td className="px-4 py-3 align-top text-gray-800 dark:text-gray-200">
                        {it.detail || '–'}
                      </td>
                    )}
                    {currentView === 'advisor' && (
                      <td className="px-4 py-3 align-top">
                        <span className="text-gray-700 dark:text-gray-300 block">
                          {formatDisplayDate(it.since)}
                        </span>
                        {it.days !== null && (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold block mt-0.5">
                            รอคุณมา {it.days} วัน
                          </span>
                        )}
                      </td>
                    )}
                    {currentView === 'advisor' && (
                      <td className="px-4 py-3 align-top">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold border bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                          ที่ปรึกษา
                        </span>
                      </td>
                    )}

                    {/* Supervisor columns */}
                    {currentView === 'supervisor' && activeTileKind !== 'no_appointment' && (
                      <td className="px-4 py-3 align-top text-gray-700 dark:text-gray-300">
                        ครั้งที่ {it.visit_number || 1}
                      </td>
                    )}
                    {currentView === 'supervisor' && activeTileKind === 'reschedule' && (
                      <td className="px-4 py-3 align-top">
                        <span className="text-gray-700 dark:text-gray-300 block">
                          เสนอ {formatDisplayDate(it.detail)}
                        </span>
                        {it.days !== null && (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold block mt-0.5">
                            ขอมา {it.days} วันก่อน
                          </span>
                        )}
                      </td>
                    )}
                    {currentView === 'supervisor' && activeTileKind === 'unrecorded_visit' && (
                      <td className="px-4 py-3 align-top">
                        <span className="text-gray-700 dark:text-gray-300 block">
                          {formatDisplayDate(it.since)}
                        </span>
                        {it.days !== null && (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold block mt-0.5">
                            ผ่านมา {it.days} วัน
                          </span>
                        )}
                      </td>
                    )}
                    {currentView === 'supervisor' && activeTileKind === 'no_appointment' && (
                      <td className="px-4 py-3 align-top">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                          ยังไม่มีนัดนิเทศ
                        </span>
                      </td>
                    )}

                    {/* Actions column */}
                    <td className="px-4 py-3 align-top text-right">
                      {currentView === 'advisor' && activeTileKind === 'outline' && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/dashboard?menu=report_outlines&tab=pending_advisor&outline=${it.ref_id}`
                            )
                          }
                          className="px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          เปิดตรวจอนุมัติ
                        </button>
                      )}
                      {currentView === 'advisor' && activeTileKind === 'report' && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/dashboard?menu=final_evaluation&student=${it.student_id}`)
                          }
                          className="px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          ตรวจรับเล่ม
                        </button>
                      )}
                      {currentView === 'advisor' && activeTileKind === 'confirmation' && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/dashboard?menu=final_evaluation&student=${it.student_id}`)
                          }
                          className="px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          ลงนามรับรอง
                        </button>
                      )}
                      {currentView === 'supervisor' && activeTileKind === 'unrecorded_visit' && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/dashboard?role=supervisor&menu=supervision_record&student=${it.student_id}&visit=${it.visit_number || 1}`
                            )
                          }
                          className="px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          บันทึกการนิเทศ (สหกิจ 13)
                        </button>
                      )}
                      {currentView === 'supervisor' && activeTileKind === 'reschedule' && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/dashboard?role=supervisor&menu=supervision&student=${it.student_id}`
                            )
                          }
                          className="px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          จัดการนัดหมาย
                        </button>
                      )}
                      {currentView === 'supervisor' && activeTileKind === 'no_appointment' && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/dashboard?role=supervisor&menu=supervision&student=${it.student_id}`
                            )
                          }
                          className="px-3 py-1.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          ร่างนัดนิเทศ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Collapsible Intent Tracking card (Advisor view only) */}
      {currentView === 'advisor' && (
        <div className="space-y-4">
          <div
            data-testid="advisor-intent-tracking"
            className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-4 shadow-sm"
          >
            <div>
              <span className="text-sm font-bold text-gray-900 dark:text-white block">
                ระบบตรวจสอบใบความจำนง (อาจารย์ที่ปรึกษา)
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">
                ใบความจำนงของนักศึกษาในสาขา {trackedIntents.length} ใบ ไปถึงขั้นไหนแล้ว — อ่านอย่างเดียว เปิดรายละเอียดด้วยปุ่ม “ตรวจทาน”
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowIntentsTable(!showIntentsTable)}
              className="px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-xs font-bold text-gray-700 dark:text-gray-300 transition-colors shrink-0 cursor-pointer"
            >
              {showIntentsTable ? 'ซ่อนตารางติดตาม' : 'เปิดตารางติดตาม'}
            </button>
          </div>

          {showIntentsTable && (
            <div className="card bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 shadow-sm page-enter">
              <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 dark:bg-gray-800/50 dark:border-gray-800">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  ใบความจำนงของนักศึกษาในความดูแล ({trackedIntents.length} รายการ)
                </span>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  การลงนามอนุมัติอยู่บนแบบคำร้องที่นักศึกษานำมาให้เซ็น — หน้านี้ไว้ติดตามว่านักศึกษาในความดูแลยื่นที่ไหนและไปถึงขั้นไหนแล้ว
                </p>
              </div>

              {trackedIntents.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-gray-50/50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-800">
                        <th className="p-3.5 font-semibold">นักศึกษา</th>
                        <th className="p-3.5 font-semibold">สถานประกอบการ</th>
                        <th className="p-3.5 font-semibold">ตำแหน่งงาน</th>
                        <th className="p-3.5 font-semibold">สถานะ</th>
                        <th className="p-3.5 font-semibold text-right">การจัดการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {trackedIntents.map((intent) => (
                        <tr
                          key={intent.form_id}
                          className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20"
                        >
                          <td className="p-3.5 font-medium text-gray-800 dark:text-gray-200">
                            <span className="block font-bold">{intentStudentName(intent)}</span>
                            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              รหัส: {intent.student_code}
                            </span>
                          </td>
                          <td className="p-3.5 text-gray-600 dark:text-gray-400 font-medium">
                            {intent.company_name_th}
                          </td>
                          <td className="p-3.5 text-gray-600 dark:text-gray-400 font-medium">
                            {intent.job_position || '–'}
                          </td>
                          <td className="p-3.5">
                            <StatusBadge
                              status={intentDisplayStatus(
                                intent.status,
                                intent.cover_letter_status
                              )}
                              domain="intent"
                            />
                          </td>
                          <td className="p-3.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                window.dispatchEvent(
                                  new CustomEvent('open-intent-review', {
                                    detail: intent.form_id,
                                  })
                                )
                              }
                              className="py-1 px-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold transition-all text-gray-700 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800 text-xs cursor-pointer"
                            >
                              ตรวจทาน
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-xs">
                  ยังไม่มีนักศึกษาในความดูแลยื่นใบความจำนง
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom informational guidelines cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        <div className="card p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl flex flex-col gap-1.5 items-center text-center">
          <span className="self-start text-[11px] font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg px-2 py-0.5">
            ทุกกองเป็นศูนย์
          </span>
          <h3 className="font-bold text-sm text-gray-900 dark:text-white">
            ตอนนี้ไม่มีอะไรรอมือคุณ
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            กองทั้ง 3 ของฝ่ายนี้ยังแสดงอยู่เสมอพร้อมเหตุผลของแต่ละกอง · ไม่ซ่อนกองที่ว่าง
          </p>
        </div>

        <div className="card p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl flex flex-col gap-1.5 items-center text-center">
          <span className="self-start text-[11px] font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg px-2 py-0.5">
            {currentView === 'advisor' ? 'เอกสารหมายเลข 1' : 'บทบาทอาจารย์นิเทศ'}
          </span>
          <h3 className="font-bold text-sm text-gray-900 dark:text-white">
            {currentView === 'advisor'
              ? 'การลงนามเอกสารหมายเลข 1 อยู่บนกระดาษ'
              : 'บันทึกการนิเทศงาน สหกิจ 13'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {currentView === 'advisor'
              ? 'นักศึกษาจะนำแบบคำร้องมาให้อาจารย์ที่ปรึกษาลงนามเอง ระบบจึงไม่นับเป็นงานที่รอกดในระบบ'
              : 'เมื่อไปนิเทศตามวันนัดแล้ว สามารถบันทึกผลการนิเทศและแบบประเมิน สหกิจ 13 ได้ที่เมนูบันทึกการนิเทศ'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdvisorHome;
