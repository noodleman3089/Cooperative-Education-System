import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api, { API_BASE_URL } from '../services/api';
import { Bell, FileText, LogOut } from 'lucide-react';
import IntentReviewModal from './IntentReviewModal';

/**
 * กระดิ่งแจ้งเตือนใช้ร่วมกันทุกบทบาท แต่แหล่งข้อมูลต่างกัน:
 * นักศึกษาได้รายการที่ประกอบขึ้นเองในไฟล์นี้ · อีก 4 บทบาทได้แถวดิบจาก
 * `/intents` หรือ `/documents` ตรงๆ · ฟิลด์จึงเป็น optional เกือบทั้งหมด
 * ตามความจริงของข้อมูล ไม่ใช่เพราะไม่รู้ว่ามีอะไร
 */
interface NotificationItem {
  // แบบที่ประกอบขึ้นสำหรับนักศึกษา
  id?: string;
  title?: string;
  description?: string;
  isWarning?: boolean;
  isSuccess?: boolean;
  isRead?: boolean;
  // แถวดิบของใบความจำนง (อาจารย์ / หัวหน้าสาขา / เจ้าหน้าที่)
  form_id?: number;
  first_name?: string | null;
  last_name?: string | null;
  company_name_th?: string | null;
  // แถวดิบของเอกสารราชการ (คณบดี)
  doc_id?: number;
  type?: string;
  student_code?: string | null;
  status?: string;
  // สำหรับฝ่ายอาจารย์ (advisor / supervisor) จาก SB-F1 / F8
  url?: string;
}

/** ส่วนของ `/profile/me` ที่แถบบนใช้ — ฟิลด์นักศึกษาเป็น optional เพราะบุคลากรไม่มี */
interface MyProfile {
  first_name?: string | null;
  last_name?: string | null;
  profile_image?: string | null;
  student_code?: string | null;
  cumulative_gpa?: number | string | null;
}

interface NavbarProps {
  currentRole: string;
  onRoleChange: (role: string) => void;
  onToggleSidebar?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ currentRole, onRoleChange, onToggleSidebar }) => {
  // index.html has already put the class on <html>; read it rather than
  // re-deriving it from localStorage and reapplying it after mount.
  const [darkMode, setDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark')
  );
  const auth = useContext(AuthContext);
  const navigate = useNavigate();

  // Notification and Modal states
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [facultyCount, setFacultyCount] = useState<number | null>(null);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  /**
   * โปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่ — null จนกว่า `/profile/me` จะตอบ
   *
   * ⛔ ข้อมูลชุดนี้เคยแสดงเป็น "แถบตัวตน" อยู่กลางหน้าแรกนักศึกษา ซึ่งซ้ำกับชื่อ
   * บนแถบบนที่เพิ่งใส่ไป · เจ้าของสั่งให้เอาแถบนั้นออกแล้วดึงข้อมูลมาไว้ตรงนี้แทน
   * (2026-09-07) ทุกค่ายังอยู่ครบ ไม่ได้ตัดอะไร แค่ย้ายที่
   * · `major_name_th` ไม่มีใน `/profile/me` (คืนมาแค่ `major_id`) จึงยังอยู่ที่หน้าโปรไฟล์
   */
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || null;
  const [selectedIntentId, setSelectedIntentId] = useState<number | null>(null);

  const toggleDarkMode = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  /**
   * ออกจากระบบ — ย้ายมาจากท้ายแถบเมนู (2026-09-07) เพราะร่างไม่มีอะไรตรงนั้น
   * session เป็น httpOnly cookie มีแต่เซิร์ฟเวอร์ที่ลบได้ จึงต้องยิง API ไม่ใช่ล้าง localStorage เฉยๆ
   */
  const handleLogout = async () => {
    setShowUserMenu(false);
    try {
      await api.post('/auth/logout');
    } catch {
      // ฝั่งเซิร์ฟเวอร์ออกไปแล้ว — ยังไงก็พาไปหน้าเข้าสู่ระบบ
    }
    auth?.logout?.();
    localStorage.removeItem('auth_user');
    localStorage.removeItem('user_role');
    window.location.href = '/login';
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      student: 'นักศึกษา',
      advisor: 'อาจารย์ที่ปรึกษา',
      supervisor: 'อาจารย์นิเทศ',
      dean: 'คณบดี',
      staff: 'เจ้าหน้าที่สหกิจ',
      dept_head: 'หัวหน้าสาขาวิชา',
      company: 'สถานประกอบการ',
      mentor: 'พี่เลี้ยงฝึกงาน'
    };
    return labels[role] || role;
  };

  // Fetch notifications based on role
  const fetchNotifications = async () => {
    if (!auth?.user) return;
    try {
      if (currentRole === 'advisor' || currentRole === 'supervisor') {
        // ยิงซ้ำกับ AdvisorHome.tsx โดยตั้งใจ — กระดิ่งอยู่ทุกหน้า ไม่ใช่แค่หน้าแรกอาจารย์
        // จึงต้องมีข้อมูลของตัวเองเสมอ แม้ผู้ใช้ไม่ได้เปิดหน้าแรกอยู่ · การแชร์ผลจะต้องมี
        // context/store ใหม่ ซึ่งเกินขอบเขตแก้จุดนี้ (ดู PROMPT-sonnet-R5 ข้อ ง)
        const res = await api.get(`/faculty/home/advisor?view=${currentRole}`);
        if (res && res.tiles) {
          const items: NotificationItem[] = [];
          if (currentRole === 'advisor') {
            const outlineCount = res.tiles.outline?.count ?? 0;
            const reportCount = res.tiles.report?.count ?? 0;
            const confirmationCount = res.tiles.confirmation?.count ?? 0;
            setFacultyCount(outlineCount + reportCount + confirmationCount);

            (res.tiles.outline?.items || []).forEach(
              (it: { ref_id: number; full_name: string; detail?: string; student_code?: string }) => {
                items.push({
                  id: `outline_${it.ref_id}`,
                  title: it.full_name,
                  description: `โครงร่างรอเห็นชอบ: ${it.detail || 'สหกิจ 11'} (${it.student_code})`,
                  url: `/dashboard?menu=report_outlines&tab=pending_advisor&outline=${it.ref_id}`,
                });
              }
            );
            (res.tiles.report?.items || []).forEach(
              (it: { student_id: number; full_name: string; student_code?: string }) => {
                items.push({
                  id: `report_${it.student_id}`,
                  title: it.full_name,
                  description: `เล่มรายงานรอตรวจรับ (${it.student_code})`,
                  url: `/dashboard?menu=final_evaluation&student=${it.student_id}`,
                });
              }
            );
            (res.tiles.confirmation?.items || []).forEach(
              (it: { student_id: number; full_name: string; student_code?: string }) => {
                items.push({
                  id: `conf_${it.student_id}`,
                  title: it.full_name,
                  description: `สหกิจ 14 รอลงนามรับรอง (${it.student_code})`,
                  url: `/dashboard?menu=final_evaluation&student=${it.student_id}`,
                });
              }
            );
          } else {
            const rescheduleCount = res.tiles.reschedule?.count ?? 0;
            const unrecordedCount = res.tiles.unrecorded_visit?.count ?? 0;
            setFacultyCount(rescheduleCount + unrecordedCount);

            (res.tiles.reschedule?.items || []).forEach(
              (it: { ref_id: number; student_id: number; full_name: string; visit_number?: number }) => {
                items.push({
                  id: `reschedule_${it.ref_id}`,
                  title: it.full_name,
                  description: `พี่เลี้ยงขอเลื่อนนัดนิเทศ (ครั้งที่ ${it.visit_number || 1})`,
                  url: `/dashboard?role=supervisor&menu=supervision&student=${it.student_id}`,
                });
              }
            );
            (res.tiles.unrecorded_visit?.items || []).forEach(
              (it: { ref_id: number; student_id: number; full_name: string; visit_number?: number }) => {
                items.push({
                  id: `unrecorded_${it.ref_id}`,
                  title: it.full_name,
                  description: `ไปนิเทศแล้วยังไม่บันทึก (ครั้งที่ ${it.visit_number || 1})`,
                  url: `/dashboard?role=supervisor&menu=supervision_record&student=${it.student_id}&visit=${it.visit_number || 1}`,
                });
              }
            );
          }
          setNotifications(items);
        }
      } else if (currentRole === 'dept_head') {
        const res = await api.get('/faculty/home/dept-head');
        if (res && res.unassigned) {
          const count = res.unassigned.students_affected ?? 0;
          setFacultyCount(count);
          const items: NotificationItem[] = (res.unassigned.items || []).map(
            (it: { student_id: number; full_name: string; student_code?: string; missing?: string[] }) => {
              const missingText =
                it.missing?.map((m: string) => (m === 'advisor' ? 'ที่ปรึกษา' : 'ผู้นิเทศ')).join(' และ ') || 'อาจารย์';
              return {
                id: `unassigned_${it.student_id}`,
                title: it.full_name,
                description: `ยังไม่มีอาจารย์${missingText} (${it.student_code || ''})`,
                url: `/dashboard?menu=assignment&filter=incomplete`,
              };
            }
          );
          setNotifications(items);
        } else {
          setFacultyCount(0);
          setNotifications([]);
        }
      } else if (currentRole === 'staff') {
        // คิวจริงของเจ้าหน้าที่คือคำร้องที่นักศึกษาอัปโหลดกลับมาแล้วรอตรวจรับ
        // ไม่ใช่ `approved_by_dept_head` ซึ่งคือใบที่ตัวเองกดรับไปแล้ว
        const res = await api.get('/intents?status=pending_officer_request');
        setNotifications(res || []);
      } else if (currentRole === 'dean') {
        const res = await api.get('/documents');
        const pendingDocs = ((res || []) as NotificationItem[]).filter((d) => d.status === 'pending_sign');
        setNotifications(pendingDocs);
      } else if (currentRole === 'student') {
        const dashboardData = await api.get('/students/dashboard');
        const studentNotifs: NotificationItem[] = [];
        if (dashboardData) {
          const { activeIntent, documents } = dashboardData;
          if (activeIntent) {
            // 1. Intent submitted
            studentNotifs.push({
              id: 'intent_submitted',
              title: 'ยื่นใบความจำนงสำเร็จ',
              description: `คุณได้ยื่นสมัครฝึกงานที่ ${activeIntent.company_name_th || 'สถานประกอบการ'} สำเร็จแล้ว`,
              status: activeIntent.status,
              isRead: false
            });

            // 2. Status message based on current status
            let desc = '';
            let isWarning = false;
            let isSuccess = false;

            if (activeIntent.status === 'pending_advisor') {
              desc = 'พิมพ์แบบคำร้องไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงนาม แล้วอัปโหลดกลับ';
            } else if (activeIntent.status === 'pending_officer_request') {
              desc = 'ส่งคำร้องที่ลงนามแล้ว รอเจ้าหน้าที่ตรวจรับ';
            } else if (activeIntent.status === 'approved_by_dept_head') {
              desc = 'เจ้าหน้าที่รับคำร้องและออกเลขที่หนังสือแล้ว รอคณบดีลงนาม';
              isSuccess = true;
            } else if (activeIntent.status === 'rejected') {
              desc = 'ใบคำร้องของคุณถูกตีกลับ กรุณาตรวจสอบเหตุผลที่หน้าแรกแล้วดำเนินการใหม่';
              isWarning = true;
              // สาขา 'rejected_by_dept_head' ถูกลบ 2026-08-27 — ไม่มีใบไหนไปถึงอีกแล้ว
            } else if (activeIntent.status === 'company_rejected') {
              desc = 'สถานประกอบการปฏิเสธการรับเข้าทำงาน ระบบปลดล็อกสิทธิ์ให้ยื่นสมัครที่ใหม่แล้ว';
              isWarning = true;
            } else if (activeIntent.status === 'accepted') {
              desc = 'สถานประกอบการตอบรับคุณเข้าปฏิบัติงานสหกิจศึกษาเรียบร้อยแล้ว!';
              isSuccess = true;
            }

            if (desc) {
              studentNotifs.push({
                id: 'intent_status',
                title: 'อัปเดตสถานะการพิจารณา',
                description: desc,
                status: activeIntent.status,
                isWarning,
                isSuccess,
                isRead: false
              });
            }

          }

          // 4. Documents
          if (documents && documents.length > 0) {
            documents.forEach((doc: { doc_id: number; type: string; status: string }) => {
              const docTypeLabel = doc.type === 'cover_letter' ? 'หนังสือขอความอนุเคราะห์' : 'หนังสือส่งตัวนักศึกษา';
              const docStatusLabel = doc.status === 'signed' ? 'ลงนามเสร็จสิ้นแล้ว' : 'รอลงนาม';
              studentNotifs.push({
                id: `doc_${doc.doc_id}`,
                title: `${docTypeLabel} (${docStatusLabel})`,
                description: doc.status === 'signed'
                  ? `คณบดีลงนามใน${docTypeLabel}แล้ว สามารถเปิดอ่านหรือนำส่งให้สถานประกอบการได้`
                  : `${docTypeLabel} อยู่ในขั้นตอนเสนอคณบดีลงนาม`,
                isSuccess: doc.status === 'signed',
                isRead: false
              });
            });
          }
        }
        setNotifications(studentNotifs);
      } else {
        setNotifications([]);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  useEffect(() => {
    fetchNotifications();

    const handleUpdate = () => {
      fetchNotifications();
    };

    const handleOpenReview = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setSelectedIntentId(customEvent.detail);
      }
    };

    window.addEventListener('intent-updated', handleUpdate);
    window.addEventListener('open-intent-review', handleOpenReview);
    return () => {
      window.removeEventListener('intent-updated', handleUpdate);
      window.removeEventListener('open-intent-review', handleOpenReview);
    };
  }, [currentRole, auth?.user]);

  /**
   * ชื่อ-นามสกุลของผู้ใช้ สำหรับแสดงบนแถบบน
   *
   * token มีแค่อีเมล จึงต้องถามเซิร์ฟเวอร์ครั้งเดียวตอนเข้า — ของเดิมโชว์อีเมลดิบ
   * ซึ่งอ่านยากและไม่ตรงกับร่างที่ตกลงกันไว้ (ร่างโชว์ชื่อจริง + อักษรย่อ)
   * · 404 = ยังไม่ได้ตั้งโปรไฟล์ ให้ตกกลับไปใช้อีเมลเหมือนเดิม ไม่ใช่ขึ้น error
   */
  useEffect(() => {
    // ไม่ล้างค่าตอนไม่มี user — ทั้งบล็อกที่แสดงผลถูกครอบด้วย `auth?.user &&` อยู่แล้ว
    // และการออกจากระบบโหลดหน้าใหม่ทั้งหน้า state จึงหายไปเอง (การ setState ตรงนี้
    // จะเป็นการเรียก setState ใน effect โดยไม่จำเป็น ซึ่ง lint ห้ามไว้)
    if (!auth?.user) return;
    let cancelled = false;
    api
      .get('/profile/me')
      .then((res) => {
        if (cancelled) return;
        setProfile((res?.profile ?? null) as MyProfile | null);
      })
      // ตั้งใจเงียบ: 404 = ยังไม่มีโปรไฟล์ หรือ role นี้ไม่มี endpoint นี้ (พี่เลี้ยง/บริษัท)
      // แถบบนตกกลับไปแสดงอีเมล ซึ่งเป็นพฤติกรรมที่ถูกแล้ว ไม่ใช่การซ่อนความพังของข้อมูลที่หน้าจอต้องใช้
      // eslint-disable-next-line no-restricted-syntax
      .catch(() => {
        /* ยังไม่มีโปรไฟล์ หรือ role นี้ไม่มี endpoint — ใช้อีเมลแทน */
      });
    return () => {
      cancelled = true;
    };
  }, [auth?.user]);

  // จอมือถือวางชื่อระบบ + ตัวสลับฝ่าย + กระดิ่ง + ธีม + อวาตาร์ไม่พอ (ฝั่งขวากว้าง ~270px จาก 375)
  // บัญชีที่มีตัวสลับจึงซ่อนชื่อระบบบนจอเล็ก — ชื่อยังอยู่หัว sidebar ที่เปิดจากปุ่มเมนู
  const hasViewSwitcher =
    !!auth?.user && ((auth.user.views?.length ? auth.user.views : auth.user.roles ?? []).length > 1);

  return (
    <>
      <nav className="h-16 border-b border-gray-200 bg-white px-4 sm:px-6 gap-2 flex items-center justify-between dark:bg-gray-900 dark:border-gray-800 transition-colors relative z-30">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors md:hidden focus:outline-none"
              aria-label="เปิดเมนูนำทาง"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <h1
            className={`text-base sm:text-lg font-bold text-brand-navy dark:text-white truncate ${
              hasViewSwitcher ? 'hidden sm:block' : ''
            }`}
          >
            ระบบสหกิจศึกษา RMUTTO
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* สลับบทบาท/ฝ่าย (Segmented Control ตามร่างดีไซน์ .design/faculty) */}
          {(() => {
            const availableViews = (auth?.user?.views && auth.user.views.length > 0)
              ? auth.user.views
              : (auth?.user?.roles ?? []);
            if (!auth?.user || availableViews.length <= 1) return null;
            return (
              <div className="relative flex items-center">
                {/* ซ่อน select ไว้ให้ E2E helper (page.getByTestId('role-switch').selectOption(...)) ใช้งานได้เสมอ */}
                <select
                  data-testid="role-switch"
                  value={currentRole}
                  onChange={(e) => onRoleChange(e.target.value)}
                  aria-label="สลับบทบาท"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  {availableViews.map((r) => (
                    <option key={r} value={r}>
                      {getRoleLabel(r)}
                    </option>
                  ))}
                </select>

                {/* มือถือ: dropdown แทน pill — จอ 375px วาง pill สองปุ่มข้างชื่อระบบ+กระดิ่ง+อวาตาร์ไม่พอ
                    ป้าย "อาจารย์ที่ปรึกษา" ถูกบีบเป็นสามบรรทัด (เจ้าของทัก 2026-09-23)
                    · คนละตัวกับ select ของ E2E ข้างบน ซึ่งซ่อนจากผู้ใช้และ screen reader */}
                <select
                  data-testid="role-switch-mobile"
                  value={currentRole}
                  onChange={(e) => onRoleChange(e.target.value)}
                  aria-label="สลับฝ่าย"
                  className="sm:hidden max-w-[9.5rem] pl-2.5 pr-7 py-1.5 rounded-[10px] text-xs font-bold bg-[#F3F4F6] text-[#1E3A8A] border border-gray-200 dark:bg-gray-800 dark:text-blue-300 dark:border-gray-700 cursor-pointer"
                >
                  {availableViews.map((r) => (
                    <option key={r} value={r}>
                      {getRoleLabel(r)}
                    </option>
                  ))}
                </select>

                {/* ตัวสลับแบบ Segmented Pill Tabs ตามดีไซน์ .design/faculty/AdvisorHome.dc.html */}
                <div
                  data-testid="role-switcher-segmented"
                  className="hidden sm:flex items-center gap-1 p-[3px] bg-[#F3F4F6] dark:bg-gray-800 rounded-[12px] border border-gray-200/60 dark:border-gray-700/60"
                >
                  {availableViews.map((r) => {
                    const isActive = currentRole === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        data-testid={`role-btn-${r}`}
                        onClick={() => onRoleChange(r)}
                        className={`px-3 py-1.5 rounded-[9px] text-xs sm:text-[13px] whitespace-nowrap transition-all cursor-pointer border-none font-sans ${
                          isActive
                            ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                            : 'bg-transparent font-medium text-[#4B5563] dark:text-gray-400 hover:text-[#111827] dark:hover:text-gray-200'
                        }`}
                      >
                        {getRoleLabel(r)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Notification Bell */}
          {auth?.user && ['advisor', 'supervisor', 'dept_head', 'staff', 'dean', 'student'].includes(currentRole) && (() => {
            const isFaculty = currentRole === 'advisor' || currentRole === 'supervisor';
            const isDeptHead = currentRole === 'dept_head';
            const notifCount = (isFaculty || isDeptHead) ? (facultyCount ?? 0) : notifications.length;

            return (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors relative cursor-pointer"
                  title={
                    currentRole === 'student'
                      ? 'ความคืบหน้าคำร้อง'
                      : isFaculty
                        ? 'งานที่รอมือคุณ'
                        : isDeptHead
                          ? 'นักศึกษาที่ยังไม่ได้จัดสรรอาจารย์'
                          : 'รายการรออนุมัติ'
                  }
                  aria-label={
                    currentRole === 'student'
                      ? 'ความคืบหน้าคำร้อง'
                      : isFaculty
                        ? 'งานที่รอมือคุณ'
                        : isDeptHead
                          ? 'นักศึกษาที่ยังไม่ได้จัดสรรอาจารย์'
                          : 'รายการรออนุมัติ'
                  }
                  aria-expanded={showNotifDropdown}
                >
                  <Bell className="h-5 w-5" />
                  {notifCount > 0 && (
                    <span className="absolute top-1 right-1 h-4 w-4 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold ring-2 ring-white dark:ring-gray-900">
                      {notifCount}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowNotifDropdown(false)}
                    ></div>
                    <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 py-2 z-40 max-h-96 overflow-y-auto">
                      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                          {currentRole === 'student'
                            ? 'ความคืบหน้าสหกิจศึกษา'
                            : isFaculty
                              ? 'งานที่รอมือคุณ'
                              : isDeptHead
                                ? 'นักศึกษาที่ยังไม่ได้จัดสรรอาจารย์'
                                : 'รายการค้างตรวจสอบ'} ({notifCount})
                        </span>
                      </div>
                      {notifications.length > 0 ? (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {notifications.map((item, index) => {
                            if (currentRole === 'student') {
                              return (
                                <button
                                  key={index}
                                  onClick={() => {
                                    setShowNotifDropdown(false);
                                    navigate('/dashboard');
                                  }}
                                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-none bg-transparent cursor-pointer"
                                >
                                  <div className={`p-1.5 rounded-lg mt-0.5 ${item.isWarning
                                    ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                                    : item.isSuccess
                                      ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                                      : 'bg-blue-50 text-brand-blue dark:bg-blue-950/30 dark:text-blue-400'
                                    }`}>
                                    <FileText className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                                      {item.title}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-normal mt-0.5 leading-normal">
                                      {item.description}
                                    </p>
                                  </div>
                                </button>
                              );
                            }

                            if (isFaculty || isDeptHead) {
                              return (
                                <button
                                  key={index}
                                  onClick={() => {
                                    setShowNotifDropdown(false);
                                    if (item.url) navigate(item.url);
                                  }}
                                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-none bg-transparent cursor-pointer"
                                >
                                  <div className="p-1.5 rounded-lg bg-blue-50 text-brand-blue dark:bg-blue-950/30 dark:text-blue-400 mt-0.5">
                                    <FileText className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                                      {item.title}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                      {item.description}
                                    </p>
                                  </div>
                                  <span className="h-2 w-2 rounded-full bg-blue-500 mt-2 shrink-0"></span>
                                </button>
                              );
                            }

                            const isDoc = currentRole === 'dean';
                            const itemId = isDoc ? item.doc_id : item.form_id;
                            return (
                              <button
                                key={index}
                                onClick={() => {
                                  setShowNotifDropdown(false);
                                  if (isDoc) {
                                    navigate('/dashboard');
                                  } else {
                                    if (itemId === undefined) return;
                                    setSelectedIntentId(itemId);
                                  }
                                }}
                                className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                              >
                                <div className="p-1.5 rounded-lg bg-blue-50 text-brand-blue dark:bg-blue-950/30 dark:text-blue-400 mt-0.5">
                                  <FileText className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                                    {isDoc
                                      ? `${item.first_name || ''} ${item.last_name || ''}`
                                      : `${item.first_name || ''} ${item.last_name || ''}`
                                    }
                                  </p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                    {isDoc
                                      ? `ลงนาม: ${item.type === 'cover_letter' ? 'หนังสือขออนุเคราะห์' : 'หนังสือส่งตัว'}`
                                      : `ฝึกงาน: ${item.company_name_th}`
                                    }
                                  </p>
                                </div>
                                <span className="h-2 w-2 rounded-full bg-blue-500 mt-2 shrink-0"></span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-xs text-gray-600 dark:text-gray-400">
                          {currentRole === 'student'
                            ? 'ยังไม่มีความคืบหน้าคำร้องในขณะนี้'
                            : isFaculty
                              ? 'ไม่มีงานรอคุณในขณะนี้'
                              : isDeptHead
                                ? 'นักศึกษาทุกคนมีอาจารย์ครบแล้ว'
                                : 'ไม่มีงานรอตรวจสอบในขณะนี้'}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Dark Mode Toggle */}

          <button
            type="button"
            onClick={toggleDarkMode}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
            title="สลับโหมดการแสดงผล"
            aria-label={darkMode ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
          >
            {darkMode ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* ตัวตนผู้ใช้ — อักษรย่อ + ชื่อจริง ตามร่าง (ของเดิมเป็นอีเมลดิบ + บทบาท
              ซึ่งอ่านยากและซ้ำกับตัวเลือกบทบาทที่อยู่ฝั่งซ้ายอยู่แล้วเมื่อมีหลาย role) */}
          {auth?.user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-expanded={showUserMenu}
                aria-label="เมนูบัญชีผู้ใช้"
              >
                {/* รูปจริงถ้ามี ไม่งั้นใช้อักษรย่อ — `dashboard-avatar-image` ย้ายมาจาก
                    หน้าแรกนักศึกษาพร้อมกับแถบตัวตน แถบบนอยู่บนหน้าแรกเหมือนกัน
                    การอัปโหลดรูปในหน้าโปรไฟล์แล้วเห็นผลที่หน้าแรกจึงยังเป็นจริง */}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 text-xs font-bold text-brand-navy dark:bg-blue-950/40 dark:text-blue-400">
                  {profile?.profile_image ? (
                    <img
                      src={`${API_BASE_URL}/files/${profile.profile_image}`}
                      alt="รูปโปรไฟล์"
                      data-testid="dashboard-avatar-image"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    (displayName ?? auth.user.email).slice(0, 2)
                  )}
                </span>
                <span className="hidden text-sm font-semibold text-gray-900 sm:block dark:text-white">
                  {displayName ?? auth.user.email}
                </span>
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                    <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
                      <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                        {auth.user.email}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {getRoleLabel(currentRole)}
                        {profile?.student_code ? ` · ${profile.student_code}` : ''}
                      </p>

                      {/* เกรดเฉลี่ย · ⛔ ป้าย "ผ่านเกณฑ์สหกิจ" ถูกตัดออก 2026-09-14 (ไม่มีการตรวจสิทธิ์ · SEC-02) */}
                      {currentRole === 'student' && profile && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-bold text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                            เกรดเฉลี่ย{' '}
                            {profile.cumulative_gpa != null
                              ? Number(profile.cumulative_gpa).toFixed(2)
                              : 'ยังไม่มี'}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* ⛔ ปุ่มนี้ย้ายมาจากท้ายแถบเมนู (ร่างไม่มีอะไรตรงนั้น) — ย้าย ไม่ใช่ลบ
                        `data-testid="logout"` ต้องคงไว้ เพราะ helper `logout(page)` ใช้เดินทั้งชุด */}
                    <button
                      type="button"
                      data-testid="logout"
                      onClick={handleLogout}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-xs font-bold text-red-700 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="h-4 w-4 shrink-0" />
                      ออกจากระบบ
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* อ่านอย่างเดียว — ไม่มี onSuccess เพราะโมดัลนี้ไม่เปลี่ยนสถานะอะไรแล้ว */}
      <IntentReviewModal
        intentId={selectedIntentId}
        onClose={() => setSelectedIntentId(null)}
      />


    </>
  );
};

export default Navbar;
