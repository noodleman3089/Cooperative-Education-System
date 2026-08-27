import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { Bell, FileText } from 'lucide-react';
import IntentReviewModal from './IntentReviewModal';
import DeanSignModal from './DeanSignModal';
import { Select } from './ui/Input';

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
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [selectedIntentId, setSelectedIntentId] = useState<number | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);

  const docDetail = selectedDocId !== null ? notifications.find((n) => n.doc_id === selectedDocId) : null;

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

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      student: 'นักศึกษา',
      advisor: 'อาจารย์ที่ปรึกษา',
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
      if (currentRole === 'advisor') {
        const res = await api.get('/intents?status=pending_advisor');
        setNotifications(res || []);
      } else if (currentRole === 'dept_head') {
        // เดิม poll `approved_by_advisor` ซึ่งไม่มีใบไหนไปถึงอีกแล้วตั้งแต่ลายเซ็นย้าย
        // ไปอยู่บนกระดาษ = กระดิ่งของหัวหน้าสาขาขึ้น 0 ตลอดกาล
        const res = await api.get('/intents?status=pending_officer_request');
        setNotifications(res || []);
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

  return (
    <>
      <nav className="h-16 border-b border-gray-200 bg-white px-6 flex items-center justify-between dark:bg-gray-900 dark:border-gray-800 transition-colors relative z-30">
        <div className="flex items-center gap-4">
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
          <h1 className="text-base sm:text-lg font-bold text-brand-navy dark:text-white truncate">
            ระบบสหกิจศึกษา RMUTTO
          </h1>
          {auth?.user && auth.user.roles.length > 1 && (
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-1 rounded-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">บทบาท:</span>
              <Select
                value={currentRole}
                onChange={(e) => onRoleChange(e.target.value)}
                className="font-semibold bg-transparent text-brand-blue cursor-pointer" size="sm"
              >
                {auth.user.roles.map((r) => (
                  <option key={r} value={r} className="bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
                    {getRoleLabel(r)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Notification Bell */}
          {auth?.user && ['advisor', 'dept_head', 'staff', 'dean', 'student'].includes(currentRole) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors relative"
                title={currentRole === 'student' ? 'ความคืบหน้าคำร้อง' : 'รายการรออนุมัติ'}
                aria-label={currentRole === 'student' ? 'ความคืบหน้าคำร้อง' : 'รายการรออนุมัติ'}
                aria-expanded={showNotifDropdown}
              >
                <Bell className="h-5 w-5" />
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 h-4 w-4 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold ring-2 ring-white dark:ring-gray-900">
                    {notifications.length}
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
                        {currentRole === 'student' ? 'ความคืบหน้าสหกิจศึกษา' : 'รายการค้างตรวจสอบ'} ({notifications.length})
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

                          const isDoc = currentRole === 'dean';
                          const itemId = isDoc ? item.doc_id : item.form_id;
                          return (
                            <button
                              key={index}
                              onClick={() => {
                                setShowNotifDropdown(false);
                                if (itemId === undefined) return;
                                if (isDoc) {
                                  setSelectedDocId(itemId);
                                } else {
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
                        {currentRole === 'student' ? 'ยังไม่มีความคืบหน้าคำร้องในขณะนี้' : 'ไม่มีงานรอตรวจสอบในขณะนี้'}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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

          {/* User Info */}
          <div className="text-right hidden sm:block">
            <span className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              {auth?.user?.email}
            </span>
            <span className="block text-xs text-gray-600 dark:text-gray-400">
              {getRoleLabel(currentRole)}
            </span>
          </div>
        </div>
      </nav>

      {/* อ่านอย่างเดียว — ไม่มี onSuccess เพราะโมดัลนี้ไม่เปลี่ยนสถานะอะไรแล้ว */}
      <IntentReviewModal
        intentId={selectedIntentId}
        onClose={() => setSelectedIntentId(null)}
      />

      <DeanSignModal
        docId={selectedDocId}
        docDetail={docDetail ?? null}
        onClose={() => setSelectedDocId(null)}
        onSuccess={() => {
          window.dispatchEvent(new CustomEvent('intent-updated'));
          setSelectedDocId(null);
        }}
      />
    </>
  );
};

export default Navbar;
