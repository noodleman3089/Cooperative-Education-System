import React, { useContext, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/authContextValue';
import api, { API_BASE_URL } from '../services/api';
import { Bell, CalendarDays, FileText, LogOut, CheckCheck, History } from 'lucide-react';
import IntentReviewModal from './IntentReviewModal';
import CoopCalendarModal from './CoopCalendarModal';
import NotificationHistoryModal from './NotificationHistoryModal';
import type { CoopCalendarResponse } from '../types/api';
import {
  type AppNotification,
  syncNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  getStoredNotifications,
} from '../utils/notificationStore';

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
  /** สถานะลิ้นชักเมนูบนจอเล็ก — ใช้บอกโปรแกรมอ่านหน้าจอผ่าน `aria-expanded` */
  isSidebarOpen?: boolean;
}

const NOTIFICATION_POLL_MS = 10_000;

const Navbar: React.FC<NavbarProps> = ({ currentRole, onRoleChange, onToggleSidebar, isSidebarOpen }) => {
  // index.html has already put the class on <html>; read it rather than
  // re-deriving it from localStorage and reapplying it after mount.
  const [darkMode, setDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark')
  );
  const auth = useContext(AuthContext);
  const navigate = useNavigate();

  // Notification and Modal states
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
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
  const [calendarData, setCalendarData] = useState<CoopCalendarResponse | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  useEffect(() => {
    if (!auth?.user) return;
    let cancelled = false;
    // ดึงข้อมูลปฏิทินล่วงหน้า เพื่อให้กดเปิดจากแถบด้านบนได้ทันทีโดยไม่ต้องรอ
    api.get('/calendar')
      .then((res) => {
        if (!cancelled && res) {
          setCalendarData(res as CoopCalendarResponse);
        }
      })
      .catch((err) => {
        console.error('Failed to preload calendar in navbar:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [auth?.user]);

  const handleOpenCalendar = async () => {
    setShowCalendarModal(true);
    if (!calendarData) {
      try {
        const res = await api.get('/calendar');
        if (res) setCalendarData(res as CoopCalendarResponse);
      } catch (err) {
        console.error('Failed to load calendar in navbar:', err);
      }
    }
  };

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
      mentor: 'พี่เลี้ยงฝึกงาน'
    };
    return labels[role] || role;
  };

  const userRoles = useMemo(() => auth?.user?.roles ?? [], [auth?.user?.roles]);
  // 'supervisor' เป็น view ไม่ใช่ role — ต้องเทียบกับ views (ถ้าไม่มีค่อยใช้ roles)
  const userViews = auth?.user?.views?.length ? auth.user.views : userRoles;
  const effectiveRole = userViews.includes(currentRole)
    ? currentRole
    : (userViews[0] ?? currentRole);

  const handleMarkAsRead = (id: string) => {
    if (!auth?.user?.userId) return;
    const updated = markAsRead(auth.user.userId, effectiveRole, id);
    setNotifications(updated);
  };

  const handleMarkAllAsRead = () => {
    if (!auth?.user?.userId) return;
    const updated = markAllAsRead(auth.user.userId, effectiveRole);
    setNotifications(updated);
  };

  const handleDelete = (id: string) => {
    if (!auth?.user?.userId) return;
    const updated = deleteNotification(auth.user.userId, effectiveRole, id);
    setNotifications(updated);
  };

  const handleDeleteAll = () => {
    if (!auth?.user?.userId) return;
    const updated = deleteAllNotifications(auth.user.userId, effectiveRole);
    setNotifications(updated);
  };

  const handleNavigateToTarget = (targetUrl?: string, highlightId?: string) => {
    if (!targetUrl) return;
    let finalUrl = targetUrl;
    if (highlightId) {
      const hasQuery = finalUrl.includes('?');
      if (!finalUrl.includes('highlight=')) {
        finalUrl += (hasQuery ? '&' : '?') + `highlight=${encodeURIComponent(highlightId)}`;
      }
    }
    navigate(finalUrl);
  };

  useEffect(() => {
    if (!auth?.user?.userId) return;
    let cancelled = false;

    // ดึงข้อมูลแคชจาก localStorage ผ่าน microtask เพื่อไม่ให้เกิด cascading render
    Promise.resolve().then(() => {
      if (!cancelled && auth?.user?.userId) {
        const cached = getStoredNotifications(auth.user.userId, effectiveRole);
        setNotifications(cached);
      }
    });

    const fetchNotifications = async () => {
      if (!auth?.user?.userId) return;
      try {
        let liveItems: Array<{
          id: string;
          title: string;
          description: string;
          type?: 'info' | 'success' | 'warning';
          targetUrl?: string;
          highlightTargetId?: string;
        }> = [];

        if (effectiveRole === 'advisor') {
          const res = await api.get('/faculty/home/advisor?view=advisor');
          if (cancelled) return;
          if (res?.tiles) {
            (res.tiles.report?.items || []).forEach(
              (it: { student_id: number; full_name: string; student_code?: string }) => {
                liveItems.push({
                  id: `report_${it.student_id}`,
                  title: it.full_name,
                  description: `เล่มรายงานรอตรวจรับ (${it.student_code || ''})`,
                  type: 'info',
                  targetUrl: `/dashboard?menu=final_evaluation&student=${it.student_id}`,
                  highlightTargetId: `student-row-${it.student_id}`,
                });
              }
            );
            (res.tiles.confirmation?.items || []).forEach(
              (it: { student_id: number; full_name: string; student_code?: string }) => {
                liveItems.push({
                  id: `conf_${it.student_id}`,
                  title: it.full_name,
                  description: `สหกิจ 14 รอลงนามรับรอง (${it.student_code || ''})`,
                  type: 'info',
                  targetUrl: `/dashboard?menu=final_evaluation&student=${it.student_id}`,
                  highlightTargetId: `student-row-${it.student_id}`,
                });
              }
            );
          }
        } else if (effectiveRole === 'supervisor') {
          const res = await api.get('/faculty/home/advisor?view=supervisor');
          if (cancelled) return;
          if (res?.tiles) {
            (res.tiles.outline?.items || []).forEach(
              (it: { ref_id: number; full_name: string; detail?: string; student_code?: string }) => {
                liveItems.push({
                  id: `outline_${it.ref_id}`,
                  title: it.full_name,
                  description: `โครงร่างรอเห็นชอบ: ${it.detail || 'สหกิจ 11'} (${it.student_code || ''})`,
                  type: 'info',
                  targetUrl: `/dashboard?role=supervisor&menu=report_outlines&tab=pending_advisor&outline=${it.ref_id}`,
                  highlightTargetId: `outline-item-${it.ref_id}`,
                });
              }
            );
            (res.tiles.reschedule?.items || []).forEach(
              (it: { ref_id: number; student_id: number; full_name: string; visit_number?: number }) => {
                liveItems.push({
                  id: `reschedule_${it.ref_id}`,
                  title: it.full_name,
                  description: `พี่เลี้ยงขอเลื่อนนัดนิเทศ (ครั้งที่ ${it.visit_number || 1})`,
                  type: 'warning',
                  targetUrl: `/dashboard?role=supervisor&menu=supervision&student=${it.student_id}`,
                  highlightTargetId: `visit-item-${it.student_id}`,
                });
              }
            );
            (res.tiles.unrecorded_visit?.items || []).forEach(
              (it: { ref_id: number; student_id: number; full_name: string; visit_number?: number }) => {
                liveItems.push({
                  id: `unrecorded_${it.ref_id}`,
                  title: it.full_name,
                  description: `ไปนิเทศแล้วยังไม่บันทึก (ครั้งที่ ${it.visit_number || 1})`,
                  type: 'warning',
                  targetUrl: `/dashboard?role=supervisor&menu=supervision_record&student=${it.student_id}&visit=${it.visit_number || 1}`,
                  highlightTargetId: `record-item-${it.student_id}`,
                });
              }
            );
          }
        } else if (effectiveRole === 'dept_head') {
          const res = await api.get('/faculty/home/dept-head');
          if (cancelled) return;
          if (res?.unassigned?.items) {
            (res.unassigned.items || []).forEach(
              (it: { student_id: number; full_name: string; student_code?: string; missing?: string[] }) => {
                const missingText =
                  it.missing?.map((m: string) => (m === 'advisor' ? 'ที่ปรึกษา' : 'ผู้นิเทศ')).join(' และ ') || 'อาจารย์';
                liveItems.push({
                  id: `unassigned_${it.student_id}`,
                  title: it.full_name,
                  description: `ยังไม่มีอาจารย์${missingText} (${it.student_code || ''})`,
                  type: 'warning',
                  targetUrl: `/dashboard?menu=assignment&filter=incomplete`,
                  highlightTargetId: `student-row-${it.student_id}`,
                });
              }
            );
          }
        } else if (effectiveRole === 'staff') {
          const res = await api.get('/staff/home');
          if (cancelled) return;
          const staffQueues: { key: 'request' | 'acceptance' | 'dispatch'; title: string }[] = [
            { key: 'request', title: 'คำร้องรอคุณตรวจรับ' },
            { key: 'acceptance', title: 'แบบตอบรับรอคุณตรวจ' },
            { key: 'dispatch', title: 'หนังสือส่งตัวรอออก' },
          ];
          for (const q of staffQueues) {
            const count: number = res?.tiles?.[q.key]?.count ?? 0;
            if (count > 0) {
              liveItems.push({
                id: `queue_${q.key}_${count}`,
                title: q.title,
                description: `${count} รายการ`,
                type: 'info',
                targetUrl: `/dashboard?queue=${q.key}`,
                highlightTargetId: `staff-queue-${q.key}`,
              });
            }
          }
          // คณบดีอนุมัติเปลี่ยนที่/ส่งตัวกลับแล้ว รอเจ้าหน้าที่ปิดใบที่ฝึก
          const closures: number = res?.memo_closures_pending ?? 0;
          if (closures > 0) {
            liveItems.push({
              id: `memo_closures_${closures}`,
              title: 'คณบดีอนุมัติให้ปิดใบที่ฝึก',
              description: `${closures} คน — ไปที่ติดตามเอกสารนักศึกษาแล้วกด "ปิดใบที่ฝึก"`,
              type: 'info',
              targetUrl: '/dashboard?menu=final_progress',
            });
          }
        } else if (effectiveRole === 'dean') {
          const res = await api.get('/documents');
          if (cancelled) return;
          const pendingDocs = ((res || []) as Array<{
            doc_id: number;
            first_name?: string | null;
            last_name?: string | null;
            type?: string;
            student_code?: string | null;
            status?: string;
          }>).filter((d) => d.status === 'pending_sign');

          liveItems = pendingDocs.map((doc) => {
            const name = [doc.first_name, doc.last_name].filter(Boolean).join(' ').trim();
            const typeLabel = doc.type === 'cover_letter' ? 'หนังสือขอความอนุเคราะห์' : 'หนังสือส่งตัว';
            return {
              id: `doc_dean_${doc.doc_id}`,
              title: name || `คำร้องรอลงนาม #${doc.doc_id}`,
              description: `ลงนาม: ${typeLabel} (${doc.student_code || ''})`,
              type: 'info' as const,
              targetUrl: '/dashboard',
              highlightTargetId: `dean-doc-row-${doc.doc_id}`,
            };
          });

          // บันทึกข้อความที่รอคณบดีตัดสิน — id ผูกกับจำนวน เพื่อให้เรื่องใหม่เข้ามาแล้วแจ้งซ้ำ
          const memoList = (await api.get('/memos')) as Array<{ status?: string }> | null;
          if (cancelled) return;
          const pendingMemoCount = (memoList ?? []).filter((m) => m.status === 'pending').length;
          if (pendingMemoCount > 0) {
            liveItems.push({
              id: `memos_pending_${pendingMemoCount}`,
              title: 'บันทึกข้อความรอพิจารณา',
              description: `${pendingMemoCount} เรื่อง รอคณบดีอนุมัติหรือไม่อนุมัติ`,
              type: 'info',
              targetUrl: '/dashboard?menu=memos',
            });
          }
        } else if (effectiveRole === 'student' && userRoles.includes('student')) {
          const dashboardData = await api.get('/students/dashboard');
          if (cancelled) return;
          if (dashboardData) {
            const { activeIntent, documents } = dashboardData;
            if (activeIntent) {
              liveItems.push({
                id: 'intent_submitted',
                title: 'ยื่นใบความจำนงสำเร็จ',
                description: `คุณได้ยื่นสมัครฝึกงานที่ ${activeIntent.company_name_th || 'สถานประกอบการ'} สำเร็จแล้ว`,
                type: 'info',
                targetUrl: '/dashboard',
                highlightTargetId: 'student-status-card',
              });

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
              } else if (activeIntent.status === 'company_rejected') {
                desc = 'สถานประกอบการปฏิเสธการรับเข้าทำงาน ระบบปลดล็อกสิทธิ์ให้ยื่นสมัครที่ใหม่แล้ว';
                isWarning = true;
              } else if (activeIntent.status === 'accepted') {
                desc = 'สถานประกอบการตอบรับคุณเข้าปฏิบัติงานสหกิจศึกษาเรียบร้อยแล้ว!';
                isSuccess = true;
              }

              if (desc) {
                liveItems.push({
                  id: `intent_status_${activeIntent.status}`,
                  title: 'อัปเดตสถานะการพิจารณา',
                  description: desc,
                  type: isWarning ? 'warning' : isSuccess ? 'success' : 'info',
                  targetUrl: '/dashboard',
                  highlightTargetId: 'student-status-card',
                });
              }
            }

            if (documents && documents.length > 0) {
              const currentDocs = documents.filter((doc: { of_closed_request?: boolean }) => !doc.of_closed_request);
              currentDocs.forEach((doc: { doc_id: number; type: string; status: string }) => {
                const docTypeLabel = doc.type === 'cover_letter' ? 'หนังสือขอความอนุเคราะห์' : 'หนังสือส่งตัวนักศึกษา';
                const docStatusLabel = doc.status === 'signed' ? 'ลงนามเสร็จสิ้นแล้ว' : 'รอลงนาม';
                liveItems.push({
                  id: `doc_${doc.doc_id}_${doc.status}`,
                  title: `${docTypeLabel} (${docStatusLabel})`,
                  description: doc.status === 'signed'
                    ? `คณบดีลงนามใน${docTypeLabel}แล้ว สามารถเปิดอ่านหรือนำส่งให้สถานประกอบการได้`
                    : `${docTypeLabel} อยู่ในขั้นตอนเสนอคณบดีลงนาม`,
                  type: doc.status === 'signed' ? 'success' : 'info',
                  targetUrl: '/dashboard',
                  highlightTargetId: `student-doc-${doc.doc_id}`,
                });
              });
            }
          }

          // คำตัดสินของคณบดีต่อบันทึกข้อความ — id ผูกกับผล (แจ้งครั้งเดียวต่อผล)
          const myMemos = (await api.get('/memos/me')) as Array<{
            memo_id: number;
            status?: string;
            decision_note?: string | null;
          }> | null;
          if (cancelled) return;
          for (const m of myMemos ?? []) {
            if (m.status === 'approved') {
              liveItems.push({
                id: `memo_${m.memo_id}_approved`,
                title: 'คณบดีอนุมัติบันทึกข้อความของคุณแล้ว',
                description: 'ดูขั้นตอนต่อไปได้ที่เมนู บันทึกถึงคณบดี',
                type: 'success',
                targetUrl: '/dashboard?menu=memos',
              });
            } else if (m.status === 'rejected') {
              liveItems.push({
                id: `memo_${m.memo_id}_rejected`,
                title: 'คณบดีไม่อนุมัติบันทึกข้อความของคุณ',
                description: m.decision_note ? `เหตุผล: ${m.decision_note}` : 'ดูเหตุผลได้ที่เมนู บันทึกถึงคณบดี',
                type: 'warning',
                targetUrl: '/dashboard?menu=memos',
              });
            }
          }
        }

        const merged = syncNotifications(auth.user.userId, effectiveRole, liveItems);
        if (!cancelled) {
          setNotifications(merged);
        }
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      }
    };

    void fetchNotifications();

    const handleUpdate = () => {
      void fetchNotifications();
    };

    const handleOpenReview = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setSelectedIntentId(customEvent.detail);
      }
    };

    // event `intent-updated` ยิงได้เฉพาะในแท็บเดียวกัน — คณบดีลงนามจากเครื่อง/บัญชีอื่น นักศึกษาจะไม่ได้รับ
    // จึงต้องถามซ้ำเป็นรอบ (ช่วงเดียวกับ useDashboardData) และข้ามตอนแท็บถูกซ่อน
    const poll = setInterval(() => {
      if (!document.hidden) void fetchNotifications();
    }, NOTIFICATION_POLL_MS);

    window.addEventListener('intent-updated', handleUpdate);
    window.addEventListener('open-intent-review', handleOpenReview);
    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener('intent-updated', handleUpdate);
      window.removeEventListener('open-intent-review', handleOpenReview);
    };
  }, [effectiveRole, auth?.user?.userId, userRoles]);

  // เมนูบนแถบบน (แจ้งเตือน · บัญชี) ปิดด้วย Esc ได้ — เดิมปิดได้ด้วยการกดนอกเมนูอย่างเดียว
  useEffect(() => {
    if (!showNotifDropdown && !showUserMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowNotifDropdown(false);
      setShowUserMenu(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showNotifDropdown, showUserMenu]);

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
              className="p-2.5 -ml-2 shrink-0 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors md:hidden"
              aria-label="เปิดเมนูนำทาง"
              aria-expanded={isSidebarOpen}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          {/* ชื่อระบบไม่ใช่หัวเรื่องของหน้า — h1 เป็นของเนื้อหาแต่ละหน้า (เดิมทุกหน้ามี h1 ซ้อนสองตัว) */}
          <div
            className={`text-base sm:text-lg font-bold text-brand-navy dark:text-white truncate ${
              hasViewSwitcher ? 'hidden sm:block' : ''
            }`}
          >
            ระบบสหกิจศึกษา RMUTTO
          </div>
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

          {/* Co-op Calendar Button — เปิดดูปฏิทินสหกิจศึกษา */}
          {auth?.user && (
            <button
              type="button"
              data-testid="navbar-calendar-btn"
              onClick={handleOpenCalendar}
              className="p-3 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors relative cursor-pointer"
              title="ปฏิทินสหกิจศึกษา"
              aria-label="ปฏิทินสหกิจศึกษา"
            >
              <CalendarDays className="h-5 w-5" />
            </button>
          )}

          {/* Notification Bell */}
          {auth?.user && ['advisor', 'supervisor', 'dept_head', 'staff', 'dean', 'student'].includes(effectiveRole) && (() => {
            const isFaculty = effectiveRole === 'advisor' || effectiveRole === 'supervisor';
            const isDeptHead = effectiveRole === 'dept_head';
            const unreadNotifications = notifications.filter((n) => !n.isDeleted && !n.readAt);
            const unreadCount = unreadNotifications.length;

            return (
              // จอเล็ก: ไม่ยึดแผงกับปุ่มกระดิ่ง (แผง 320px จะล้นขอบซ้ายจอ) ให้ยึดกับแถบ <nav> แทน
              <div className="sm:relative">
                <button
                  type="button"
                  data-testid="navbar-bell-btn"
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  className="p-3 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors relative cursor-pointer"
                  title={
                    effectiveRole === 'student'
                      ? 'ความคืบหน้าคำร้อง'
                      : isFaculty
                        ? 'งานที่รอมือคุณ'
                        : isDeptHead
                          ? 'นักศึกษาที่ยังไม่ได้จัดสรรอาจารย์'
                          : 'รายการรออนุมัติ'
                  }
                  aria-label={
                    effectiveRole === 'student'
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
                  {unreadCount > 0 && (
                    <span
                      data-testid="navbar-unread-badge"
                      className="absolute top-2 right-2 h-4 w-4 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold ring-2 ring-white dark:ring-gray-900"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowNotifDropdown(false)}
                    />
                    <div className="absolute inset-x-2 top-full mt-2 sm:inset-x-auto sm:right-0 sm:w-84 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 py-2 z-40 max-h-[28rem] flex flex-col">
                      {/* Header ของ Dropdown */}
                      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                          {effectiveRole === 'student'
                            ? 'ความคืบหน้าสหกิจศึกษา'
                            : isFaculty
                              ? 'งานที่รอมือคุณ'
                              : isDeptHead
                                ? 'นักศึกษาที่ยังไม่ได้จัดสรรอาจารย์'
                                : 'รายการค้างตรวจสอบ'} ({unreadCount})
                        </span>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAllAsRead}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            title="ทำเครื่องหมายว่าอ่านทั้งหมด"
                          >
                            <CheckCheck className="w-3 h-3" />
                            อ่านทั้งหมด
                          </button>
                        )}
                      </div>

                      {/* รายการที่ยังไม่ได้อ่าน (แสดงสูงสุด 5 รายการในป๊อปอัปกระดิ่ง) */}
                      <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
                        {unreadNotifications.length > 0 ? (
                          unreadNotifications.slice(0, 5).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                handleMarkAsRead(item.id);
                                setShowNotifDropdown(false);
                                handleNavigateToTarget(item.targetUrl, item.highlightTargetId);
                              }}
                              className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors border-none bg-transparent cursor-pointer"
                            >
                              <div
                                className={`p-1.5 rounded-lg mt-0.5 shrink-0 ${
                                  item.type === 'warning'
                                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                                    : item.type === 'success'
                                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                      : 'bg-blue-50 text-brand-blue dark:bg-blue-950/40 dark:text-blue-400'
                                }`}
                              >
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                                    {item.title}
                                  </p>
                                  <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-normal mt-0.5 leading-normal">
                                  {item.description}
                                </p>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="text-center py-8 px-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                            <p className="font-semibold text-gray-700 dark:text-gray-300">ไม่มีการแจ้งเตือนใหม่</p>
                            <p>รายการที่อ่านแล้วจะย้ายไปเก็บที่ประวัติการแจ้งเตือน</p>
                          </div>
                        )}
                      </div>

                      {/* Footer: ปุ่มเปิดดูประวัติทั้งหมด */}
                      <div className="border-t border-gray-100 dark:border-gray-700 p-2 bg-gray-50/50 dark:bg-gray-800/50">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNotifDropdown(false);
                            setShowHistoryModal(true);
                          }}
                          className="w-full py-2 px-3 text-xs font-bold text-center text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-gray-700 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs border border-gray-200/60 dark:border-gray-700/60"
                        >
                          <History className="w-3.5 h-3.5" />
                          ดูประวัติการแจ้งเตือนทั้งหมด
                        </button>
                      </div>
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
            // จอเล็กปุ่มนี้ย้ายเข้าเมนูบัญชี — แถบบนไม่พอที่เมื่อขยายตัวอักษร (กระดิ่งเคยทับปุ่มเปิดเมนู)
            className={`${auth?.user ? 'hidden sm:block ' : ''}p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors`}
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
                  <div className="absolute right-0 z-40 mt-2 w-56 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
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
                      onClick={toggleDarkMode}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3.5 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 sm:hidden dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      {darkMode ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
                    </button>
                    <button
                      type="button"
                      data-testid="logout"
                      onClick={handleLogout}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3.5 text-left text-xs font-bold text-red-700 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
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

      {/* ปฏิทินสหกิจศึกษา — เปิดได้จากทุกหน้าผ่านแถบด้านบน */}
      {showCalendarModal && calendarData && (
        <CoopCalendarModal
          data={calendarData}
          onClose={() => setShowCalendarModal(false)}
        />
      )}

      {/* ประวัติการแจ้งเตือนทั้งหมด */}
      <NotificationHistoryModal
        open={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        notifications={notifications}
        onMarkAsRead={handleMarkAsRead}
        onMarkAllAsRead={handleMarkAllAsRead}
        onDelete={handleDelete}
        onDeleteAll={handleDeleteAll}
        onNavigateToTarget={handleNavigateToTarget}
      />
    </>
  );
};

export default Navbar;
