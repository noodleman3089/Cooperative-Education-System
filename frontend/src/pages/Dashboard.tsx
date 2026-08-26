import React, { useContext, useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import PageSkeleton, { skeletonFor } from '../components/ui/Skeleton';
import Button from '../components/ui/Button';
import { statusText } from '../components/ui/StatusBadge';
import api from '../services/api';
import { Lock } from 'lucide-react';
import { getErrorStatus } from '../utils/errors';
import { formatThaiDate, formatThaiRange } from '../utils/thaiDate';
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
const AdvisorDashboard = lazy(() => import('../components/AdvisorDashboard'));
const DeptHeadDashboard = lazy(() => import('../components/DeptHeadDashboard'));
const DeanDashboard = lazy(() => import('../components/DeanDashboard'));
const StaffDashboard = lazy(() => import('../components/StaffDashboard'));
const CompanyDashboard = lazy(() => import('../components/CompanyDashboard'));
const PersonnelProfile = lazy(() => import('../components/PersonnelProfile'));
const AccommodationWorkPlan = lazy(() => import('./Student/AccommodationWorkPlan'));
const ReportOutline = lazy(() => import('./Student/ReportOutline'));
const WeeklyLog = lazy(() => import('./Student/WeeklyLog'));
const SupervisionTracking = lazy(() => import('./Advisor/SupervisionTracking'));
const AppointmentAudit = lazy(() => import('./Staff/AppointmentAudit'));
const FinalReportSubmission = lazy(() => import('./Student/FinalReportSubmission'));
const EvaluationResult = lazy(() => import('./Student/EvaluationResult'));
const MentorEvaluation = lazy(() => import('./Company/MentorEvaluation'));
const MentorProfile = lazy(() => import('./Company/MentorProfile'));
const AdvisorEvaluation = lazy(() => import('./Advisor/AdvisorEvaluation'));
const FinalProgressDashboard = lazy(() => import('./Staff/FinalProgressDashboard'));
const CompanyDirectory = lazy(() => import('./Staff/CompanyDirectory'));
const CoopCalendarManager = lazy(() => import('./Staff/CoopCalendarManager'));
const CoopApplicationForm = lazy(() => import('./Student/CoopApplicationForm'));
const ApplicationReview = lazy(() => import('./Advisor/ApplicationReview'));

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

/**
 * กิจกรรมในปฏิทินสหกิจ → เมนูที่ควรขึ้นกุญแจเมื่ออยู่นอกช่วงที่เจ้าหน้าที่ตั้งไว้
 *
 * นี่คือความรู้ของฝั่ง UI ล้วนๆ — backend ไม่รู้จักคำว่า "เมนู" มันรู้แค่ว่า
 * endpoint ไหนถูกล็อกด้วย key ไหน (`middlewares/calendarGate.ts`) จึงเก็บไว้ที่นี่
 *
 * `intent_submission` จงใจไม่อยู่ในนี้: เมนู jobs ต้องเปิดให้ดูประกาศงานได้เสมอ
 * เหมือนที่ STAGE_GATED_STUDENT_MENUS ไม่ล็อก jobs — ตัวปุ่มยื่นบนการ์ดเป็นคน
 * อธิบายเอง เพราะเซิร์ฟเวอร์ตอบ 403 พร้อมข้อความไทยเต็มอยู่แล้ว
 */
const CALENDAR_LOCKED_MENU_BY_ACTIVITY: Record<string, string> = {
  coop_application: 'application',
  accommodation_plan: 'accommodation_plan',
  weekly_log: 'weekly_log',
  report_outline: 'report_outline',
  final_report: 'final_report',
};

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

const Dashboard: React.FC = () => {
  const auth = useContext(AuthContext);
  
  /**
   * Starts at the signed-in user's own role, not at 'student'.
   *
   * It used to open on 'student' and correct itself in the effect below, so
   * every other role watched StudentDashboard flash past on each page load —
   * and that screen fires /students/dashboard, which answered 403 and logged an
   * error for a request nobody wanted. `ProtectedRoute` already waits for
   * `isLoading` before mounting this, so `auth.user` is populated by now and
   * there is nothing to wait for. The effect stays for the role switcher.
   */
  const [currentRole, setCurrentRole] = useState<string>(auth?.user?.roles?.[0] ?? 'student');
  const [activeMenu, setActiveMenu] = useState<string>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  useEffect(() => {
    if (auth?.user && auth.user.roles.length > 0) {
      setCurrentRole(auth.user.roles[0]);
    }
  }, [auth?.user]);

  // How far through the co-op this student is, purely to decide which menus are
  // usable yet. Only the two facts the gate needs are kept.
  const [stage, setStage] = useState<StudentStage | null>(null);
  // ปฏิทินสหกิจ — อีกด่านหนึ่งที่ล็อกเมนู คนละเรื่องกับ stage ด้านบน
  const [calendar, setCalendar] = useState<CoopCalendarResponse | null>(null);

  useEffect(() => {
    if (currentRole !== 'student') {
      setStage(null);
      setCalendar(null);
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
      const menuId = CALENDAR_LOCKED_MENU_BY_ACTIVITY[activity.activity_key];
      // not_configured = เจ้าหน้าที่ยังไม่ตั้ง = ยังไม่มีกฎ ต้องไม่ล็อก (fail-open
      // ตรงกับ middlewares/calendarGate.ts ฝั่งเซิร์ฟเวอร์)
      if (!menuId || !activity.start_date || !activity.end_date) continue;

      if (activity.status === 'upcoming') {
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
            `หมดช่วง "${activity.label}" แล้ว (เปิดถึงวันที่ ${formatThaiDate(activity.end_date)}) ` +
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
  }, []);

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
        if (activeMenu === 'application') return <CoopApplicationForm />;
        if (activeMenu === 'jobs') return <SmartJobBoard />;
        if (activeMenu === 'profile') return <StudentProfile />;
        if (activeMenu === 'accommodation_plan') return <AccommodationWorkPlan />;
        if (activeMenu === 'report_outline') return <ReportOutline />;
        if (activeMenu === 'weekly_log') return <WeeklyLog />;
        if (activeMenu === 'final_report') return <FinalReportSubmission />;
        if (activeMenu === 'evaluation_result') return <EvaluationResult />;
        return <StudentDashboard />;
        
      case 'advisor':
        if (activeMenu === 'applications') return <ApplicationReview />;
        if (activeMenu === 'profile') return <PersonnelProfile />;
        if (activeMenu === 'supervision') return <SupervisionTracking />;
        if (activeMenu === 'final_evaluation') return <AdvisorEvaluation />;
        return <AdvisorDashboard activeMenu={activeMenu} />;
        
      case 'dept_head':
        if (activeMenu === 'applications') return <ApplicationReview />;
        if (activeMenu === 'profile') return <PersonnelProfile />;
        if (activeMenu === 'final_progress') return <FinalProgressDashboard />;
        return <DeptHeadDashboard activeMenu={activeMenu} />;
        
      case 'dean':
        if (activeMenu === 'signature') return <DeanDashboard activeMenu="signature" />;
        if (activeMenu === 'profile') return <PersonnelProfile />;
        return <DeanDashboard activeMenu="dashboard" />;
        
      case 'staff':
        if (activeMenu === 'appointments') return <AppointmentAudit />;
        if (activeMenu === 'jobs') return <StaffDashboard activeMenu="jobs" />;
        if (activeMenu === 'announcements') return <StaffDashboard activeMenu="announcements" />;
        if (activeMenu === 'users') return <StaffDashboard activeMenu="users" />;
        if (activeMenu === 'import') return <StaffDashboard activeMenu="import" />;
        if (activeMenu === 'companies') return <CompanyDirectory />;
        if (activeMenu === 'calendar') return <CoopCalendarManager />;
        if (activeMenu === 'final_progress') return <FinalProgressDashboard />;
        if (activeMenu === 'profile') return <PersonnelProfile />;
        return <StaffDashboard activeMenu="dashboard" />;
        
      case 'company':
        if (activeMenu === 'jobs') return <CompanyDashboard activeMenu="jobs" />;
        if (activeMenu === 'report_outlines') return <CompanyDashboard activeMenu="report_outlines" />;
        if (activeMenu === 'final_evaluation') return <MentorEvaluation />;
        if (activeMenu === 'profile') return <CompanyDashboard activeMenu="profile" />;
        return <CompanyDashboard activeMenu="dashboard" />;

      case 'mentor':
        if (activeMenu === 'report_outlines') return <CompanyDashboard activeMenu="report_outlines" />;
        if (activeMenu === 'final_evaluation') return <MentorEvaluation />;
        // Not PersonnelProfile: a mentor is not university staff and has no row
        // in `personnel`, so that screen could only ever show them an error.
        if (activeMenu === 'profile') return <MentorProfile />;
        return <MentorEvaluation />;
        
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
          onRoleChange={(role) => {
            setCurrentRole(role);
            setActiveMenu('dashboard'); // Reset to home dashboard on role swap
          }} 
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
