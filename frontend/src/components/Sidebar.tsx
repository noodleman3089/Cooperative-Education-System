import React, { useState } from 'react';
import api from '../services/api';

interface SidebarProps {
  currentRole: string;
  activeMenu: string;
  onMenuChange: (menuId: string) => void;
  onLogout?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  /**
   * Menu id → the reason it is not usable yet. Locked items are dimmed and
   * carry a padlock, but stay clickable on purpose: the screen behind them
   * explains the wait in full. A button that silently does nothing when
   * pressed reads as a broken page, not as a rule.
   */
  lockedMenus?: Record<string, string>;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentRole,
  activeMenu,
  onMenuChange,
  onLogout,
  isOpen = false,
  lockedMenus = {}
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // 100% Unique, Distinct Icons for Every Menu Item (No Duplicates)
  const icons = {
    // 1. Dashboard / Home
    dashboard: (
      <svg className="h-4 w-4 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
      </svg>
    ),
    // 2. Jobs / Smart Job
    jobs: (
      <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    // 3. Accommodation & Map
    accommodation: (
      <svg className="h-4 w-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    // 4. Report Outline
    report_outline: (
      <svg className="h-4 w-4 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    // 5. Weekly Log
    weekly_log: (
      <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    // 6. Final Report
    final_report: (
      <svg className="h-4 w-4 shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    // 7. Profile / Settings
    profile: (
      <svg className="h-4 w-4 shrink-0 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    // 8. Students / Graduation
    students: (
      <svg className="h-4 w-4 shrink-0 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 01-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
    // 9. Supervision
    supervision: (
      <svg className="h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.998 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
    // 10. Evaluation
    evaluation: (
      <svg className="h-4 w-4 shrink-0 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    // 11. Approval
    approval: (
      <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
    // 12. Advisor Assignment
    assignment: (
      <svg className="h-4 w-4 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
    // 13. Final Progress / Summary Grades
    summary: (
      <svg className="h-4 w-4 shrink-0 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    // 14. E-Signature Config
    signature: (
      <svg className="h-4 w-4 shrink-0 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
    // 15b. Company directory
    companies: (
      <svg className="h-4 w-4 shrink-0 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    // 16. PR Announcements
    announcements: (
      <svg className="h-4 w-4 shrink-0 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
    // 16b. Co-op calendar (activity windows)
    calendar: (
      <svg className="h-4 w-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    // 17. Appointments Check
    appointments: (
      <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    // 18. User Roles & Permission Management
    users: (
      <svg className="h-4 w-4 shrink-0 text-fuchsia-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    // 19. Grade Import & Screening
    import: (
      <svg className="h-4 w-4 shrink-0 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
    // 20. Co-op 01 Application (เข้าร่วมโครงการ)
    application: (
      <svg className="h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    // 21. Logout Action
    logout: (
      <svg className="h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    )
  };

  const menuConfig: Record<string, MenuItem[]> = {
    student: [
      { id: 'dashboard', label: 'หน้าแรก / แดชบอร์ด', icon: icons.dashboard },
      { id: 'application', label: 'สมัครเข้าโครงการ (สหกิจ 01)', icon: icons.application },
      { id: 'jobs', label: 'ตำแหน่งงาน / สมัครงาน', icon: icons.jobs },
      { id: 'job_application', label: 'ใบสมัครงานสหกิจ (สหกิจ 03)', icon: icons.application },
      { id: 'accommodation_plan', label: 'รายละเอียดที่พัก & แผนงาน', icon: icons.accommodation },
      { id: 'report_outline', label: 'โครงร่างรายงานปฏิบัติงาน', icon: icons.report_outline },
      { id: 'weekly_log', label: 'บันทึกการทำงานรายสัปดาห์', icon: icons.weekly_log },
      { id: 'final_report', label: 'รายงานการปฏิบัติงานสมบูรณ์', icon: icons.final_report },
      // ผลประเมินจากพี่เลี้ยง — เซิร์ฟเวอร์เปิดให้ดูหลังสิ้นสุดช่วงปฏิบัติงานเท่านั้น
      // เมนูจึงอยู่ตลอด แต่ปลายทางเป็นหน้าอธิบายว่าจะเปิดเมื่อไหร่ (ไม่ใช่ปุ่มตาย)
      { id: 'evaluation_result', label: 'ผลประเมินจากพี่เลี้ยง', icon: icons.evaluation },
      // บันทึกข้อความกรณียกเว้น — ไม่ล็อกตามขั้นตอนหรือปฏิทิน เพราะเหตุจำเป็น
      // เกิดได้ทุกช่วง และการปิดเมนูนี้เท่ากับปิดทางออกเดียวของคนที่ตกกรณียกเว้น
      { id: 'memos', label: 'บันทึกข้อความถึงคณบดี', icon: icons.report_outline },
      { id: 'profile', label: 'ข้อมูลส่วนตัว & เรซูเม่', icon: icons.profile }
    ],
    advisor: [
      { id: 'dashboard', label: 'แดชบอร์ดที่ปรึกษา', icon: icons.dashboard },
      { id: 'applications', label: 'ตรวจใบสมัครเข้าโครงการ (สหกิจ 01)', icon: icons.application },
      { id: 'students', label: 'รายชื่อนักศึกษาในที่ปรึกษา', icon: icons.students },
      { id: 'report_outlines', label: 'ตรวจโครงร่างรายงาน', icon: icons.report_outline },
      { id: 'supervision', label: 'นัดหมายและติดตามการนิเทศ', icon: icons.supervision },
      // สหกิจ 13 — คนละหน้ากับ 'supervision' ด้านบน: ตัวนั้นคือการนัดและติดตาม
      // ตัวนี้คือแบบฟอร์ม 37 ข้ออย่างเป็นทางการ
      { id: 'supervision_record', label: 'แบบบันทึกการนิเทศ (สหกิจ 13)', icon: icons.evaluation },
      // อาจารย์ไม่ได้ประเมิน — ทั้ง สหกิจ 15 และ 16 เป็นของพนักงานที่ปรึกษาตามแบบฟอร์มจริง
      // หน้านี้คือการตรวจอนุมัติเล่มรายงาน (สหกิจ 14) + ดูผลประเมินอย่างเดียว
      // menu id คงเดิมโดยตั้งใจ: ผูกอยู่ 5 ที่รวม NavId ของ e2e การเปลี่ยนควรเป็น commit แยก
      { id: 'final_evaluation', label: 'ตรวจเล่มรายงานฉบับสมบูรณ์', icon: icons.evaluation },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile }
    ],
    dept_head: [
      { id: 'dashboard', label: 'ภาพรวมสาขาวิชา', icon: icons.dashboard },
      { id: 'applications', label: 'อนุมัติใบสมัครเข้าโครงการ (สหกิจ 01)', icon: icons.application },
      // หัวหน้าสาขาไม่ได้ "อนุมัติ" ในระบบแล้ว — ลายเซ็นอยู่บนแบบคำร้อง (เอกสารหมายเลข 1)
      // หน้านี้เหลือหน้าที่ติดตามอย่างเดียว ป้ายเมนูจึงต้องไม่สัญญาว่ามีปุ่มให้กด
      { id: 'approval', label: 'ติดตามคำร้อง', icon: icons.approval },
      { id: 'assignment', label: 'จัดสรรอาจารย์ที่ปรึกษา', icon: icons.assignment },
      { id: 'students', label: 'ตรวจสอบคุณสมบัตินักศึกษา', icon: icons.students },
      { id: 'final_progress', label: 'สรุปผลการประเมินสาขาวิชา', icon: icons.summary },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile }
    ],
    dean: [
      { id: 'dashboard', label: 'แดชบอร์ดเอกสารอนุมัติ', icon: icons.dashboard },
      { id: 'signature', label: 'ตั้งค่าลายมือชื่อดิจิทัล', icon: icons.signature },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile }
    ],
    staff: [
      // ⛔ เมนู 'dispatch_letters' (ออกหนังสือส่งตัวนักศึกษา) ถูกถอดออก 2026-08-27
      //    หน้านั้นถูกลบไปตั้งแต่ 2026-08-26 พร้อม POST /documents/generate-dispatch
      //    แต่เมนูยังค้างอยู่ — กดแล้วเด้งกลับแดชบอร์ดเงียบๆ เพราะ StaffDashboard
      //    ตีเมนูที่ไม่รู้จักเป็น 'dashboard' · เมนูที่พาไปหน้าอื่นไม่ได้คือเมนูตาย
      { id: 'dashboard', label: 'คำร้องขอหนังสือ & การออกเลข', icon: icons.dashboard },
      { id: 'jobs', label: 'อนุมัติประกาศงาน', icon: icons.jobs },
      { id: 'companies', label: 'ทำเนียบสถานประกอบการ', icon: icons.companies },
      { id: 'announcements', label: 'จัดการข่าวประชาสัมพันธ์', icon: icons.announcements },
      { id: 'calendar', label: 'ปฏิทินสหกิจศึกษา', icon: icons.calendar },
      { id: 'appointments', label: 'ตรวจสอบการนัดหมาย', icon: icons.appointments },
      { id: 'users', label: 'จัดการสิทธิ์ & บัญชีผู้ใช้', icon: icons.users },
      { id: 'import', label: 'นำเข้าเกรด & คัดกรองนักศึกษา', icon: icons.import },
      { id: 'final_progress', label: 'สรุปผลการประเมินสาขาวิชา', icon: icons.summary },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile }
    ],
    company: [
      { id: 'dashboard', label: 'แดชบอร์ดผู้สมัครงาน', icon: icons.dashboard },
      { id: 'jobs', label: 'ตำแหน่งงานว่างของบริษัท', icon: icons.jobs },
      { id: 'report_outlines', label: 'ตรวจโครงร่างรายงาน', icon: icons.report_outline },
      { id: 'final_evaluation', label: 'ประเมินผลนักศึกษา', icon: icons.evaluation },
      { id: 'profile', label: 'ข้อมูลและประวัติบริษัท', icon: icons.profile }
    ],
    mentor: [
      { id: 'dashboard', label: 'รายชื่อนักศึกษาประเมิน', icon: icons.dashboard },
      { id: 'report_outlines', label: 'ตรวจโครงร่างรายงาน', icon: icons.report_outline },
      { id: 'final_evaluation', label: 'ประเมินผลนักศึกษา', icon: icons.evaluation },
      { id: 'profile', label: 'ข้อมูลส่วนตัว', icon: icons.profile }
    ]
  };

  const activeMenuItems = menuConfig[currentRole] || [
    { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
    { id: 'profile', label: 'ข้อมูลส่วนตัว', icon: icons.profile }
  ];

  const handleLogoutClick = async () => {
    if (onLogout) {
      onLogout();
      return;
    }
    // The session cookie is httpOnly, so only the server can drop it.
    try {
      await api.post('/auth/logout');
    } catch {
      // Already signed out server-side; still send the user to the login page.
    }
    localStorage.removeItem('auth_user');
    localStorage.removeItem('user_role');
    window.location.href = '/login';
  };

  return (
    <aside
      className={`bg-gray-900 text-gray-400 flex flex-col border-r border-gray-800 shrink-0 fixed md:static inset-y-0 left-0 z-40 transform transition-all duration-300 md:translate-x-0 ${isCollapsed ? 'w-16' : 'w-56'
        } ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      {/* Header Bar with Logo and Toggle Button « / » */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800 bg-gray-950/80">
        {!isCollapsed ? (
          <>
            <span className="text-white font-extrabold text-xs tracking-wider uppercase truncate">
              Coop Edu Portal
            </span>
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors cursor-pointer"
              title="พับเก็บเมนู (Collapse Sidebar)"
              aria-label="พับเก็บเมนู"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </>
        ) : (
          <div className="w-full flex items-center justify-center">
            <button
              type="button"
              onClick={() => setIsCollapsed(false)}
              className="p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors cursor-pointer"
              title="ขยายเมนู (Expand Sidebar)"
              aria-label="ขยายเมนู"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {activeMenuItems.map((item) => {
          const isActive = activeMenu === item.id;
          const lockReason = lockedMenus[item.id];
          return (
            <button
              key={item.id}
              type="button"
              // Menu ids are stable; the Thai labels are not, and E2E used to
              // navigate by clicking those labels.
              data-testid={`nav-${item.id}`}
              onClick={() => onMenuChange(item.id)}
              title={lockReason || (isCollapsed ? item.label : undefined)}
              // Without this the tooltip becomes the accessible name and the
              // menu reads out as the reason with no clue which menu it is.
              aria-label={lockReason ? `${item.label} (ยังไม่เปิดให้ใช้) ${lockReason}` : undefined}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${isCollapsed ? 'justify-center' : ''
                } ${isActive
                  ? 'bg-brand-blue text-white shadow-sm shadow-blue-500/20 font-bold'
                  // Locked items keep the same text colour as the rest.
                  // Greying the label to gray-600 put it at 2.35:1 on this
                  // sidebar — the padlock and the dimmed icon say "not yet"
                  // without making the words hard to read. (See the dark-mode
                  // round in CLAUDE.md: a disabled *look* is not a licence to
                  // drop below AA when the control is still clickable.)
                  : 'hover:bg-gray-800 hover:text-gray-200 text-gray-400'
                }`}
            >
              <span className={lockReason && !isActive ? 'flex opacity-40' : 'flex'}>{item.icon}</span>
              {!isCollapsed && (
                <span className="flex-1 text-left truncate">{item.label}</span>
              )}
              {lockReason && !isCollapsed && (
                <svg
                  className="h-3.5 w-3.5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
          );
        })}
      </nav>

      {/* Unified Bottom Footer with Integrated Logout Button */}
      <div className="p-2 border-t border-gray-800 bg-gray-950/60 space-y-2">
        <button
          type="button"
          data-testid="logout"
          onClick={handleLogoutClick}
          title={isCollapsed ? 'ออกจากระบบ' : undefined}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all cursor-pointer ${isCollapsed ? 'justify-center' : ''
            }`}
        >
          {icons.logout}
          {!isCollapsed && <span className="truncate">ออกจากระบบ</span>}
        </button>

        {!isCollapsed && (
          <div className="text-center">
            {/* The sidebar is dark chrome in both themes, so this needs the
                lighter grey unconditionally, not only under dark:. */}
            <span className="text-xs text-gray-400">RMUTTO Coop v1.0.0</span>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
