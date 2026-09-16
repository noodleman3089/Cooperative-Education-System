import React, { useCallback, useContext, useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import PageSkeleton, { skeletonFor } from '../components/ui/Skeleton';
import Button from '../components/ui/Button';
import { statusText } from '../components/ui/StatusBadge';
import api from '../services/api';
import EmptyState from '../components/ui/EmptyState';
import { Lock } from 'lucide-react';
import { getErrorStatus } from '../utils/errors';
import { formatThaiDate, formatThaiRange } from '../utils/thaiDate';
import { CALENDAR_MENU_BY_ACTIVITY } from '../utils/calendarMenus';
import type { CoopCalendarResponse } from '../types/api';

/**
 * Every screen in the application hangs off this one switch, so this is also
 * the only place worth splitting it. Imported eagerly, the whole product —
 * every role's dashboard and every form — was one 3 MB file that a student had
 * to finish downloading before the login page could paint. Split, a session
 * fetches the handful of screens that session actually opens.
 */
const StudentDashboard = lazy(() => import('../components/StudentDashboard'));
const SmartJobBoard = lazy(() => import('../components/SmartJobBoard'));
const StudentProfile = lazy(() => import('../components/StudentProfile'));
const AdvisorHome = lazy(() => import('./Advisor/AdvisorHome'));
const AdvisorStudents = lazy(() => import('./Advisor/AdvisorStudents'));
const OutlineReview = lazy(() => import('./Advisor/OutlineReview'));
const FacultyMemos = lazy(() => import('./Faculty/FacultyMemos'));
const DeptHeadHome = lazy(() => import('./DeptHead/DeptHeadHome'));
const AdvisorAssignment = lazy(() => import('./DeptHead/AdvisorAssignment'));
const PetitionTracking = lazy(() => import('./DeptHead/PetitionTracking'));
const DeanSignQueue = lazy(() => import('./Dean/DeanSignQueue'));
const DeanSignature = lazy(() => import('./Dean/DeanSignature'));
const StaffHome = lazy(() => import('./Staff/StaffHome'));
const JobOfferManager = lazy(() => import('./Staff/JobOfferManager'));
const UsersAndMasterData = lazy(() => import('./Staff/UsersAndMasterData'));
const ImportScreening = lazy(() => import('./Staff/ImportScreening'));
const AnnouncementsManager = lazy(() => import('./Staff/AnnouncementsManager'));
const PersonnelProfile = lazy(() => import('../components/PersonnelProfile'));
const AccommodationWorkPlan = lazy(() => import('./Student/AccommodationWorkPlan'));
const CoopJobApplication = lazy(() => import('./Student/CoopJobApplication'));
const ReportOutline = lazy(() => import('./Student/ReportOutline'));
const WeeklyLog = lazy(() => import('./Student/WeeklyLog'));
const SupervisionTracking = lazy(() => import('./Advisor/SupervisionTracking'));
const SupervisionRecord = lazy(() => import('./Advisor/SupervisionRecord'));
const AppointmentAudit = lazy(() => import('./Staff/AppointmentAudit'));
const FinalReportSubmission = lazy(() => import('./Student/FinalReportSubmission'));
const EvaluationResult = lazy(() => import('./Student/EvaluationResult'));
const MentorEvaluation = lazy(() => import('./Company/MentorEvaluation'));
const MentorProfile = lazy(() => import('./Company/MentorProfile'));
const AdvisorEvaluation = lazy(() => import('./Advisor/AdvisorEvaluation'));
const FinalProgressDashboard = lazy(() => import('./Staff/FinalProgressDashboard'));
const CompanyDirectory = lazy(() => import('./Staff/CompanyDirectory'));
const CoopCalendarManager = lazy(() => import('./Staff/CoopCalendarManager'));
const StudentMemo = lazy(() => import('./Student/StudentMemo'));
const Form07Company = lazy(() => import('./Company/Form07Company'));
const MentorHome = lazy(() => import('./Company/MentorHome'));
const MentorCertify = lazy(() => import('./Company/MentorCertify'));
const CompanyHome = lazy(() => import('./Company/CompanyHome'));
const JobOffer02 = lazy(() => import('./Company/JobOffer02'));
const ReportOutlineQueue = lazy(() => import('./Company/ReportOutlineQueue'));
const CompanyProfile = lazy(() => import('./Company/CompanyProfile'));

/**
 * The four student screens that belong to the co-op itself rather than to
 * getting placed on one. The server already refuses every one of them without
 * an accepted intent — `weeklyLog.ts`, `reportOutline.ts` and the accommodation
 * handler in `student.ts` all answer 400 "No accepted cooperative education
 * intent found" — so this is not a new rule, it is the existing rule finally
 * showing up before the student fills a form out.
 *
 * `jobs` is deliberately not here: browsing postings before applying is the
 * point of that screen, and the board already explains its own disabled button.
 */
const STAGE_GATED_STUDENT_MENUS = [
  'accommodation_plan',
  'report_outline',
  'weekly_log',
  'final_report',
  // ยังไม่มีที่ฝึกงาน = ยังไม่มีพี่เลี้ยง = ไม่มีทางมีผลประเมิน
  'evaluation_result',
] as const;

interface StudentStage {
  hasProfile: boolean;
  intentStatus: string | null;
}

/** Full-screen version of the padlock in the sidebar, with the way forward. */
const StageLockedScreen: React.FC<{
  /** หัวเรื่องต้องตรงกับเหตุผลจริง — "ยังไม่ถึงขั้นตอนนี้" ใช้กับกรณีหมดช่วงไม่ได้
   *  มันบอกตรงข้ามกับความจริงและทำให้นักศึกษาเข้าใจว่ารออีกหน่อยแล้วจะเปิด */
  heading: string;
  reason: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ heading, reason, actionLabel, onAction }) => (
  <div className="page-enter mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      <Lock className="h-7 w-7" />
    </div>
    <h3 className="text-lg font-bold text-gray-800 dark:text-white">{heading}</h3>
    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500 dark:text-gray-400">
      {reason}
    </p>
    <Button className="mt-6" onClick={onAction}>
      {actionLabel}
    </Button>
  </div>
);

const SUB_QUERIES_TO_CLEAR = [
  'queue', 'form', 'tab', 'offer', 'company',
  'tile', 'scope', 'student', 'outline', 'visit', 'type', 'doc', 'view', 'major',
  'filter', 'stage'
];
const SUPERVISOR_EXCLUSIVE_MENUS = ['supervision', 'supervision_record'];
const ADVISOR_EXCLUSIVE_MENUS = ['report_outlines', 'memos', 'final_evaluation'];

const Dashboard: React.FC = () => {
  const auth = useContext(AuthContext);
  
  /**
   * รองรับ ?role= ตามสเปก D ข้อ 14.5 และ F ข้อ 1.1 / 2.3
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMenu = searchParams.get('menu') || 'dashboard';
  const roleParam = searchParams.get('role');

  const userViews = useMemo(() => {
    if (auth?.user?.views && auth.user.views.length > 0) {
      return auth.user.views;
    }
    return auth?.user?.roles ?? ['student'];
  }, [auth?.user?.views, auth?.user?.roles]);

  const currentRole = useMemo(() => {
    // 1. ?role= ใช้ได้เฉพาะฝ่ายที่ผู้ใช้มีจริง (สเปก F 1.1) ไม่งั้นใช้ view แรก
    const base =
      roleParam && userViews.includes(roleParam) ? roleParam : (userViews[0] ?? 'student');
    // 2. ?menu= ของอีกฝ่าย → เปิดฝ่ายนั้นเอง **เฉพาะเมื่ออยู่ฝ่ายอาจารย์**
    //    ⛔ id พวกนี้บทบาทอื่นใช้ด้วย (`memos` นักศึกษา · `report_outlines`/`final_evaluation`
    //    พี่เลี้ยงและบริษัท) — สลับให้ทุกคนแล้วหน้าจอของบทบาทนั้นกลายเป็นจอว่าง
    //    · ไม่มีฝ่ายปลายทาง → case ด้านล่างแสดง faculty-view-empty
    if (base === 'advisor' || base === 'supervisor') {
      if (SUPERVISOR_EXCLUSIVE_MENUS.includes(activeMenu)) return 'supervisor';
      if (ADVISOR_EXCLUSIVE_MENUS.includes(activeMenu)) return 'advisor';
    }
    return base;
  }, [activeMenu, roleParam, userViews]);

  const handleRoleChange = useCallback(
    (role: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set('role', role);
          next.delete('menu'); // รีเซ็ต menu เป็นหน้าแรกเมื่อสลับบทบาท (พฤติกรรมเดิม)
          // ล้าง sub-queries ของบทบาทเดิมเพื่อไม่ให้ค้างข้ามบทบาท (สเปก F 1.1)
          SUB_QUERIES_TO_CLEAR.forEach(q => next.delete(q));
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const setActiveMenu = useCallback(
    (menu: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          // รักษา role ถ้าไม่ใช่ view แรกหรือมี roleParam กำหนดไว้
          if (roleParam) {
            next.set('role', roleParam);
          } else if (currentRole && currentRole !== userViews[0]) {
            next.set('role', currentRole);
          }
          // หน้าแรกไม่ต้องมีพารามิเตอร์ ให้ `/dashboard` เปล่าๆ ยังเป็น URL ของหน้าแรก
          if (menu === 'dashboard') next.delete('menu');
          else next.set('menu', menu);
          // ล้าง sub-queries ของเมนูเดิมเมื่อสลับเมนูหลัก (สเปก F 1.1)
          SUB_QUERIES_TO_CLEAR.forEach(q => next.delete(q));
          return next;
        },
        // ตั้งใจให้ push เข้าประวัติ ไม่ใช่ replace — ปุ่ม Back ต้องย้อนเมนูได้
        { replace: false }
      );
    },
    [setSearchParams, roleParam, currentRole, userViews]
  );

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // How far through the co-op this student is, purely to decide which menus are
  // usable yet. Only the two facts the gate needs are kept.
  const [stage, setStage] = useState<StudentStage | null>(null);
  // ปฏิทินสหกิจ — อีกด่านหนึ่งที่ล็อกเมนู คนละเรื่องกับ stage ด้านบน
  const [calendar, setCalendar] = useState<CoopCalendarResponse | null>(null);

  useEffect(() => {
    if (currentRole !== 'student') {
      return;
    }

    let cancelled = false;
    const load = async () => {
      // allSettled ไม่ใช่ all — ปฏิทินล่มต้องไม่ทำให้ stage หาย และกลับกัน
      // (BUG-03 ตระกูลเดียวกัน เกิดมาสามครั้งแล้วในโปรเจคนี้)
      const [stageRes, calRes] = await Promise.allSettled([
        api.get('/students/dashboard'),
        api.get('/calendar'),
      ]);
      if (cancelled) return;

      if (stageRes.status === 'fulfilled') {
        setStage({
          hasProfile: true,
          intentStatus: stageRes.value?.activeIntent?.status ?? null,
        });
      } else if (getErrorStatus(stageRes.reason) === 404) {
        // 404 is the student who has not filled the profile in yet. Anything
        // else is the server having a bad day, and a bad day must not invent a
        // padlock — leave the menus as they were.
        setStage({ hasProfile: false, intentStatus: null });
      }

      if (calRes.status === 'fulfilled') {
        setCalendar(calRes.value as CoopCalendarResponse);
      }
    };

    load();

    // Unlocking is somebody else's action — the company answering, or staff
    // approving the paper acceptance — so there is nothing here to poll for.
    // Re-check when the tab comes back and when a screen says an intent moved.
    window.addEventListener('focus', load);
    window.addEventListener('intent-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
      window.removeEventListener('intent-updated', load);
    };
  }, [currentRole]);

  /** ล็อกที่มาจากปฏิทิน — กิจกรรมที่ยังไม่ถึงช่วง หรือหมดช่วงไปแล้ว
   *  เก็บ heading คู่กับ reason เพราะสองกรณีนี้ต้องพาดหัวคนละแบบ */
  const calendarLocks = useMemo<Record<string, { heading: string; reason: string }>>(() => {
    if (currentRole !== 'student' || !calendar) return {};

    const locks: Record<string, { heading: string; reason: string }> = {};
    for (const activity of calendar.activities) {
      // ⛔ ใช้ตารางร่วมกับปุ่มกดในปฏิทิน (`utils/calendarMenus.ts`) แต่เคารพ
      //    `locksMenu` ด้วย — เมนูที่ทำหลายอย่าง (jobs · dashboard) ห้ามถูกล็อก
      //    ทั้งเมนูเพราะกิจกรรมเดียวหมดเวลา
      const target = CALENDAR_MENU_BY_ACTIVITY[activity.activity_key];
      const menuId = target?.locksMenu ? target.menu : undefined;
      // `locks: false` = หมุดบอกเวลา (วันเริ่ม/วันสิ้นสุด/วันสอบ) ไม่ใช่ด่าน —
      // เซิร์ฟเวอร์ไม่ปฏิเสธอะไรจากมัน หน้าจอจึงต้องไม่แขวนกุญแจให้เหมือนกัน
      if (!menuId || !activity.locks) continue;
      // ไม่มีวันปิด = เจ้าหน้าที่ยังไม่ตั้ง = ยังไม่มีกฎ ต้องไม่ล็อก (fail-open
      // ตรงกับ middlewares/calendarGate.ts ฝั่งเซิร์ฟเวอร์)
      // ⛔ เช็ค end_date อย่างเดียว ไม่เช็ค start_date — ชนิด "ภายในวันที่" ไม่มีวันเริ่ม
      //    โดยตั้งใจ การเช็ค start ด้วยจะทำให้เส้นตายไม่ล็อกอะไรเลยเงียบๆ
      if (!activity.end_date) continue;

      // ชนิด "ภายในวันที่" ไม่มีวันเริ่ม จึงพูดว่า "เปิดถึงวันที่" ไม่ได้ —
      // คนอ่านจะนึกว่ามีวันเริ่มที่ตัวเองพลาดไป (กติกาเดียวกับ calendarGate.ts)
      const closedOn =
        activity.date_kind === 'deadline'
          ? `กำหนดส่งคือภายในวันที่ ${formatThaiDate(activity.end_date)}`
          : `เปิดถึงวันที่ ${formatThaiDate(activity.end_date)}`;

      // สถานะ upcoming เกิดได้เฉพาะเมื่อมีวันเริ่ม (ดู calendarStatus) — เช็คซ้ำให้ TS สบายใจ
      if (activity.status === 'upcoming' && activity.start_date) {
        locks[menuId] = {
          heading: 'ยังไม่ถึงช่วงที่เปิดให้ทำรายการ',
          reason:
            `ยังไม่ถึงช่วง "${activity.label}" ตามปฏิทินสหกิจศึกษา ` +
            `ระบบจะเปิดให้ทำรายการวันที่ ${formatThaiRange(activity.start_date, activity.end_date)} ` +
            `— ระหว่างนี้รอเจ้าหน้าที่งานสหกิจศึกษาเปิดช่วงตามกำหนด`,
        };
      } else if (activity.status === 'closed') {
        locks[menuId] = {
          heading: 'หมดช่วงที่เปิดให้ทำรายการแล้ว',
          reason:
            `หมดช่วง "${activity.label}" แล้ว (${closedOn}` +
            (activity.late_end_date
              ? ` และผ่อนผันถึงวันที่ ${formatThaiDate(activity.late_end_date)}`
              : ``) +
            `) ` +
            `ระบบจึงไม่รับรายการใหม่ — หากจำเป็นต้องส่งย้อนหลัง ` +
            `ให้ติดต่ออาจารย์ที่ปรึกษาพร้อมบันทึกข้อความชี้แจงเหตุผล ` +
            `อาจารย์จะเสนอหัวหน้าสาขาวิชาและส่งเรื่องต่อไปที่คณะให้ (นักศึกษายื่นเรื่องเองไม่ได้)`,
        };
      }
    }
    return locks;
  }, [currentRole, calendar]);

  /** ล็อกตามขั้นตอนของนักศึกษาคนนั้น — ของเดิม ไม่เกี่ยวกับเวลา */
  const stageLocks = useMemo<Record<string, string>>(() => {
    if (currentRole !== 'student' || !stage || stage.intentStatus === 'accepted') return {};

    const reason = !stage.hasProfile
      ? 'เมนูนี้จะเปิดให้ใช้เมื่อสถานประกอบการตอบรับคุณเข้าปฏิบัติงานแล้ว ตอนนี้ยังไม่มีข้อมูลประวัตินักศึกษาในระบบ กรุณากรอกประวัติให้ครบก่อน'
      : stage.intentStatus === null
        ? 'เมนูนี้จะเปิดให้ใช้เมื่อสถานประกอบการตอบรับคุณเข้าปฏิบัติงานแล้ว ตอนนี้ยังไม่ได้ยื่นแบบแจ้งความจำนงไปที่สถานประกอบการใด'
        : `เมนูนี้จะเปิดให้ใช้เมื่อสถานประกอบการตอบรับคุณเข้าปฏิบัติงานแล้ว สถานะใบความจำนงตอนนี้: ${statusText(stage.intentStatus, 'intent')}`;

    return Object.fromEntries(STAGE_GATED_STUDENT_MENUS.map((id) => [id, reason]));
  }, [currentRole, stage]);

  /**
   * stage ทับ calendar โดยตั้งใจ — ด่านที่มาก่อนในเส้นทางชนะ
   * ถ้ายังไม่มีที่ฝึกงาน การบอกว่า "หมดช่วงส่งบันทึกรายสัปดาห์" ไม่ช่วยอะไรเลย
   */
  const lockedMenus = useMemo<Record<string, string>>(() => {
    const fromCalendar = Object.fromEntries(
      Object.entries(calendarLocks).map(([menu, lock]) => [menu, lock.reason])
    );
    return { ...fromCalendar, ...stageLocks };
  }, [calendarLocks, stageLocks]);

  useEffect(() => {
    const handleNavigation = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setActiveMenu(customEvent.detail);
      }
    };
    window.addEventListener('navigate', handleNavigation);
    return () => window.removeEventListener('navigate', handleNavigation);
    // `setActiveMenu` ผูกกับ `setSearchParams` ซึ่งเปลี่ยนตัวได้เมื่อ location เปลี่ยน
    // — ต้องอยู่ใน deps ไม่งั้น listener ค้างอยู่กับ setter ของหน้าเก่า
  }, [setActiveMenu]);

  if (!auth || !auth.user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F3F4F6] dark:bg-[#111827]">
        <div className="text-sm text-gray-500 dark:text-gray-400">กรุณาเข้าสู่ระบบก่อนใช้งาน</div>
      </div>
    );
  }

  // Render sub-component content dynamically based on currentRole and activeMenu
  const renderDashboardContent = () => {
    switch (currentRole) {
      case 'student':
        if (lockedMenus[activeMenu]) {
          // ล็อกด้วยปฏิทินล้วน (ไม่ใช่ขั้นตอน) → ปุ่มพากลับไปหน้าแรกที่มีปฏิทินให้ดู
          const calendarLock = !stageLocks[activeMenu] ? calendarLocks[activeMenu] : undefined;
          const calendarOnly = !!calendarLock;
          const needsProfile = !calendarOnly && (stage ? !stage.hasProfile : false);
          return (
            <StageLockedScreen
              heading={calendarLock ? calendarLock.heading : 'ยังไม่ถึงขั้นตอนนี้'}
              reason={lockedMenus[activeMenu]}
              actionLabel={
                calendarOnly
                  ? 'ดูปฏิทินสหกิจศึกษา'
                  : needsProfile
                    ? 'กรอกประวัตินักศึกษา'
                    : stage?.intentStatus
                      ? 'ดูสถานะใบความจำนง'
                      : 'เลือกตำแหน่งงานเพื่อยื่นความจำนง'
              }
              onAction={() =>
                setActiveMenu(
                  calendarOnly
                    ? 'dashboard'
                    : needsProfile
                      ? 'profile'
                      : stage?.intentStatus
                        ? 'dashboard'
                        : 'jobs'
                )
              }
            />
          );
        }
        // ⛔ 'application' (สหกิจ 01) และ 'applications' ของอาจารย์/หัวหน้าสาขา ถูกตัดทั้งชุด 2026-09-14
        if (activeMenu === 'jobs') return <SmartJobBoard />;
        if (activeMenu === 'profile') return <StudentProfile />;
        if (activeMenu === 'job_application') return <CoopJobApplication />;
        if (activeMenu === 'accommodation_plan') return <AccommodationWorkPlan />;
        if (activeMenu === 'report_outline') return <ReportOutline />;
        if (activeMenu === 'weekly_log') return <WeeklyLog />;
        if (activeMenu === 'final_report') return <FinalReportSubmission />;
        if (activeMenu === 'evaluation_result') return <EvaluationResult />;
        if (activeMenu === 'memos') return <StudentMemo />;
        return <StudentDashboard />;
        
      case 'advisor':
        if (!userViews.includes('advisor')) {
          return (
            <div data-testid="faculty-view-empty">
              <EmptyState
                title="ไม่มีสิทธิ์เข้าถึงฝ่ายที่ปรึกษา"
                description="คุณยังไม่ได้รับมอบหมายเป็นอาจารย์ที่ปรึกษาของนักศึกษาคนใด"
              />
            </div>
          );
        }
        if (activeMenu === 'profile') return <PersonnelProfile />;
        if (activeMenu === 'students') return <AdvisorStudents />;
        if (activeMenu === 'report_outlines') return <OutlineReview />;
        if (activeMenu === 'memos') return <FacultyMemos />;
        if (activeMenu === 'final_evaluation') return <AdvisorEvaluation />;
        return <AdvisorHome view="advisor" />;

      case 'supervisor':
        if (!userViews.includes('supervisor')) {
          return (
            <div data-testid="faculty-view-empty">
              <EmptyState
                title="ไม่มีสิทธิ์เข้าถึงฝ่ายนิเทศ"
                description="คุณยังไม่ได้รับมอบหมายเป็นอาจารย์นิเทศของนักศึกษาคนใด"
              />
            </div>
          );
        }
        if (activeMenu === 'profile') return <PersonnelProfile />;
        if (activeMenu === 'students') return <AdvisorStudents />;
        if (activeMenu === 'supervision') return <SupervisionTracking />;
        if (activeMenu === 'supervision_record') return <SupervisionRecord />;
        return <AdvisorHome view="supervisor" />;
        
      case 'dept_head':
        if (activeMenu === 'profile') return <PersonnelProfile />;
        if (activeMenu === 'final_progress') return <FinalProgressDashboard />;
        if (activeMenu === 'memos') return <FacultyMemos />;
        // ลิงก์เก่า ?menu=students (ตรวจสอบคุณสมบัติ — ถอดออก 2026-09-14) ไปหน้ารายชื่อที่ยังมีอยู่
        //   แทนที่จะเปิดหน้าว่าง · เมนูที่พาไปหน้าอื่นไม่ได้คือเมนูตาย
        if (activeMenu === 'students' || activeMenu === 'assignment') return <AdvisorAssignment />;
        if (activeMenu === 'approval') return <PetitionTracking />;
        return <DeptHeadHome />;
        
      case 'dean':
        if (activeMenu === 'signature') return <DeanSignature onNavigate={setActiveMenu} />;
        if (activeMenu === 'memos') return <FacultyMemos showMajorFilter />;
        if (activeMenu === 'profile') return <PersonnelProfile />;
        return <DeanSignQueue onNavigate={setActiveMenu} />;
        
      case 'staff':
        if (activeMenu === 'appointments') return <AppointmentAudit />;
        if (activeMenu === 'jobs') return <JobOfferManager />;
        if (activeMenu === 'announcements') return <AnnouncementsManager />;
        if (activeMenu === 'users') return <UsersAndMasterData />;
        if (activeMenu === 'import') return <ImportScreening />;
        if (activeMenu === 'companies') return <CompanyDirectory />;
        if (activeMenu === 'calendar') return <CoopCalendarManager />;
        if (activeMenu === 'final_progress') return <FinalProgressDashboard />;
        if (activeMenu === 'profile') return <PersonnelProfile />;
        return <StaffHome />;
        
      case 'company':
        if (activeMenu === 'jobs') return <JobOffer02 />;
        if (activeMenu === 'form07') return <Form07Company />;
        if (activeMenu === 'report_outlines') return <ReportOutlineQueue />;
        if (activeMenu === 'final_evaluation') return <MentorEvaluation />;
        if (activeMenu === 'profile') return <CompanyProfile />;
        return <CompanyHome onNavigate={(menu) => setActiveMenu(menu)} />;

      case 'mentor':
        if (activeMenu === 'certify') return <MentorCertify />;
        if (activeMenu === 'report_outlines') return <ReportOutlineQueue />;
        if (activeMenu === 'final_evaluation') return <MentorEvaluation />;
        // Not PersonnelProfile: a mentor is not university staff and has no row
        // in `personnel`, so that screen could only ever show them an error.
        if (activeMenu === 'profile') return <MentorProfile />;
        return <MentorHome />;
        
      default:
        if (activeMenu === 'profile') return (
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-[#1F2937] dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
            ไม่รองรับบทบาทการแสดงผลนี้ กรุณาเปลี่ยนบทบาทการใช้งานของท่านด้านบน
          </div>
        );
        return (
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-[#1F2937] dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
            ไม่รองรับบทบาทการแสดงผลนี้ กรุณาเปลี่ยนบทบาทการใช้งานของท่านด้านบน
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F3F4F6] dark:bg-[#111827] transition-colors relative">
      {/* Backdrop overlay for mobile drawer */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      <Sidebar 
        currentRole={currentRole} 
        activeMenu={activeMenu} 
        onMenuChange={(menu) => {
          setActiveMenu(menu);
          setSidebarOpen(false);
        }} 
        onLogout={() => auth.logout()}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        lockedMenus={lockedMenus}
      />
      
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <Navbar 
          currentRole={currentRole} 
          onRoleChange={handleRoleChange} 
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
        
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#F3F4F6] dark:bg-[#111827] transition-colors w-full">
          <Suspense fallback={<PageSkeleton variant={skeletonFor(currentRole, activeMenu)} />}>
            {renderDashboardContent()}
          </Suspense>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
