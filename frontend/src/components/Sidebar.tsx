import React, { useState } from 'react';

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
  /**
   * หัวข้อกลุ่มที่รายการนี้อยู่ใต้ — ใส่เฉพาะ role ที่เมนูยาวจนอ่านไม่ออกว่าอะไรก่อนอะไรหลัง
   *
   * ตัวเรนเดอร์ขึ้นหัวข้อให้เองเมื่อค่า `group` เปลี่ยนจากรายการก่อนหน้า จึงต้องเรียง
   * รายการในกลุ่มเดียวกันติดกันเสมอ · รายการที่ไม่มี `group` ไม่มีหัวข้อคั่น
   *
   * ⛔ **`id` ห้ามเปลี่ยน** — มันคือ `data-testid="nav-<id>"` ที่ E2E ใช้เดินทั้งชุด
   * ส่วน `label` เปลี่ยนได้อิสระ (ตรวจแล้ว 2026-09-07: ไม่มี spec ไหนคลิกด้วยข้อความ)
   */
  group?: string;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentRole,
  activeMenu,
  onMenuChange,
  isOpen = false,
  lockedMenus = {}
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // 100% Unique, Distinct Icons for Every Menu Item (No Duplicates)
  const icons = {
    // 1. Dashboard / Home
    dashboard: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
      </svg>
    ),
    // 2. เมนู `jobs` ของนักศึกษา = ยื่นคำร้องขอหนังสือ (เอกสารหมายเลข 1)
    jobs: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    // 3. Accommodation & Map
    accommodation: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    // 4. Report Outline
    report_outline: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    // 5. Weekly Log
    weekly_log: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    // 6. Final Report
    final_report: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    // 7. Profile / Settings
    profile: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    // 8. Students / Graduation
    students: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 01-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
    // 9. Supervision
    supervision: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.998 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
    // 10. Evaluation
    evaluation: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    // 11. Approval
    approval: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
    // 12. Advisor Assignment
    assignment: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
    // 13. Final Progress / Summary Grades
    summary: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    // 14. E-Signature Config
    signature: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
    // 15b. Company directory
    companies: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    // 16. PR Announcements
    announcements: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
    // 16b. Co-op calendar (activity windows)
    calendar: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    // 17. Appointments Check
    appointments: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    // 18. User Roles & Permission Management
    users: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    // 19. Grade Import & Screening
    import: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
    // 20. Co-op 01 Application (เข้าร่วมโครงการ)
    application: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    // 21. Logout Action
    logout: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    ),
    // 24. Mentor follow-up (ติดตามพี่เลี้ยง)
    mentor_followup: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    // 23. Certify (รับรองงานนักศึกษา)
    certify: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    )
  };

  const menuConfig: Record<string, MenuItem[]> = {
    /**
     * เมนูนักศึกษาจัดตาม **ช่วงเวลาของสหกิจ** ไม่ใช่ตามชื่อแบบฟอร์ม (2026-09-07)
     *
     * เดิมเป็นรายการเรียงแบน 11 อัน ตั้งชื่อตามเอกสารที่มันแทน — นักศึกษาวันแรกจึงเห็น
     * ตู้เอกสารทั้งตู้ โดยที่ ~8 อันล็อกอยู่ และไม่มีอะไรบอกว่าอะไรมาก่อนอะไร
     * การจัดกลุ่มไม่ได้ตัดเมนูไหนออกเลย ทุกความสามารถยังอยู่ครบ เปลี่ยนแค่ลำดับกับชื่อ
     *
     * ป้ายสั้นลงได้เพราะหัวข้อกลุ่มบอกบริบทแทนแล้ว — "ใบสมัครงานสหกิจ (สหกิจ 03)"
     * ไม่ต้องแบกคำว่าสหกิจ 03 ไว้บนแถบแคบๆ อีก (เลขเอกสารยังอยู่บนหัวหน้าจอปลายทาง)
     */
    student: [
      { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },

      { id: 'jobs', label: 'ยื่นคำร้องขอหนังสือ', icon: icons.jobs, group: 'ก่อนออกฝึก' },
      { id: 'job_application', label: 'ใบสมัครงานสหกิจ', icon: icons.application, group: 'ก่อนออกฝึก' },
      { id: 'accommodation_plan', label: 'ที่พักและแผนงาน', icon: icons.accommodation, group: 'ก่อนออกฝึก' },

      { id: 'weekly_log', label: 'บันทึกการปฏิบัติงาน', icon: icons.weekly_log, group: 'ระหว่างฝึก' },
      { id: 'report_outline', label: 'โครงร่างรายงาน', icon: icons.report_outline, group: 'ระหว่างฝึก' },
      // บันทึกข้อความกรณียกเว้น — ไม่ล็อกตามขั้นตอนหรือปฏิทิน เพราะเหตุจำเป็น
      // เกิดได้ทุกช่วง และการปิดเมนูนี้เท่ากับปิดทางออกเดียวของคนที่ตกกรณียกเว้น
      { id: 'memos', label: 'บันทึกถึงคณบดี', icon: icons.report_outline, group: 'ระหว่างฝึก' },

      { id: 'final_report', label: 'รายงานฉบับสมบูรณ์', icon: icons.final_report, group: 'หลังฝึกเสร็จ' },
      // ผลประเมินจากพี่เลี้ยง — เซิร์ฟเวอร์เปิดให้ดูหลังสิ้นสุดช่วงปฏิบัติงานเท่านั้น
      // เมนูจึงอยู่ตลอด แต่ปลายทางเป็นหน้าอธิบายว่าจะเปิดเมื่อไหร่ (ไม่ใช่ปุ่มตาย)
      { id: 'evaluation_result', label: 'ผลประเมิน', icon: icons.evaluation, group: 'หลังฝึกเสร็จ' },

      { id: 'profile', label: 'ข้อมูลส่วนตัว', icon: icons.profile, group: 'บัญชีของฉัน' }
    ],
    advisor: [
      { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
      { id: 'students', label: 'นักศึกษาในสาขา', icon: icons.students, group: 'ระหว่างปฏิบัติงาน' },
      { id: 'report_outlines', label: 'เห็นชอบโครงร่าง (สหกิจ 11)', icon: icons.report_outline, group: 'ระหว่างปฏิบัติงาน' },
      { id: 'memos', label: 'บันทึกข้อความนักศึกษา', icon: icons.report_outline, group: 'ระหว่างปฏิบัติงาน' },
      { id: 'mentor_followup', label: 'ติดตามพี่เลี้ยง', icon: icons.mentor_followup, group: 'ระหว่างปฏิบัติงาน' },
      { id: 'final_evaluation', label: 'ตรวจรับเล่มรายงาน (สหกิจ 14)', icon: icons.evaluation, group: 'ปลายภาค' },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile, group: 'บัญชีของฉัน' }
    ],
    supervisor: [
      { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
      { id: 'students', label: 'นักศึกษาที่ฉันนิเทศ', icon: icons.students, group: 'การนิเทศ' },
      { id: 'supervision', label: 'นัดหมายนิเทศ (สหกิจ 12)', icon: icons.supervision, group: 'การนิเทศ' },
      { id: 'supervision_record', label: 'บันทึกการนิเทศ (สหกิจ 13)', icon: icons.evaluation, group: 'การนิเทศ' },
      { id: 'mentor_followup', label: 'ติดตามพี่เลี้ยง', icon: icons.mentor_followup, group: 'การนิเทศ' },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile, group: 'บัญชีของฉัน' }
    ],
    dept_head: [
      { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
      { id: 'assignment', label: 'จัดสรรอาจารย์ที่ปรึกษา & นิเทศ', icon: icons.assignment, group: 'งานของสาขาวิชา' },
      // หัวหน้าสาขาไม่ได้ "อนุมัติ" ในระบบแล้ว — ลายเซ็นอยู่บนแบบคำร้อง (เอกสารหมายเลข 1)
      // หน้านี้เหลือหน้าที่ติดตามอย่างเดียว ป้ายเมนูจึงต้องไม่สัญญาว่ามีปุ่มให้กด
      { id: 'approval', label: 'ติดตามคำร้อง (เอกสารหมายเลข 1)', icon: icons.approval, group: 'งานของสาขาวิชา' },
      { id: 'final_progress', label: 'ติดตามเอกสาร & ผลประเมิน', icon: icons.summary, group: 'งานของสาขาวิชา' },
      { id: 'mentor_followup', label: 'ติดตามพี่เลี้ยง', icon: icons.mentor_followup, group: 'งานของสาขาวิชา' },
      { id: 'memos', label: 'บันทึกข้อความนักศึกษา', icon: icons.report_outline, group: 'งานของสาขาวิชา' },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile, group: 'บัญชีของฉัน' }
    ],
    dean: [
      { id: 'dashboard', label: 'หนังสือรอลงนาม', icon: icons.dashboard },
      { id: 'signature', label: 'ลายมือชื่อสำหรับหนังสือราชการ', icon: icons.signature },
      { id: 'memos', label: 'บันทึกข้อความนักศึกษา', icon: icons.report_outline },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile, group: 'บัญชีของฉัน' }
    ],
    staff: [
      { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
      { id: 'companies', label: 'ทำเนียบสถานประกอบการ', icon: icons.companies, group: 'งานตามฤดูกาล' },
      { id: 'appointments', label: 'นัดหมายนิเทศ (สหกิจ 12)', icon: icons.appointments, group: 'งานตามฤดูกาล' },
      { id: 'final_progress', label: 'ติดตามเอกสารนักศึกษา', icon: icons.summary, group: 'งานตามฤดูกาล' },
      { id: 'mentor_followup', label: 'ติดตามพี่เลี้ยง', icon: icons.mentor_followup, group: 'งานตามฤดูกาล' },
      { id: 'calendar', label: 'ปฏิทินสหกิจศึกษา', icon: icons.calendar, group: 'ตั้งค่าของคณะ' },
      { id: 'import', label: 'รายชื่อนักศึกษา & เกรด', icon: icons.import, group: 'ตั้งค่าของคณะ' },
      { id: 'users', label: 'บัญชี สิทธิ์ และข้อมูลหลัก', icon: icons.users, group: 'ตั้งค่าของคณะ' },
      { id: 'announcements', label: 'ข่าวประชาสัมพันธ์', icon: icons.announcements, group: 'ตั้งค่าของคณะ' },
      { id: 'profile', label: 'การตั้งค่าโปรไฟล์', icon: icons.profile, group: 'บัญชีของฉัน' }
    ],
    mentor: [
      { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
      { id: 'certify', label: 'รับรองงานนักศึกษา', icon: icons.certify },
      { id: 'report_outlines', label: 'ตรวจโครงร่างรายงาน', icon: icons.report_outline },
      { id: 'final_evaluation', label: 'แบบประเมินนักศึกษา', icon: icons.evaluation },
      { id: 'profile', label: 'ข้อมูลส่วนตัว', icon: icons.profile }
    ]
  };

  const activeMenuItems = menuConfig[currentRole] || [
    { id: 'dashboard', label: 'หน้าแรก', icon: icons.dashboard },
    { id: 'profile', label: 'ข้อมูลส่วนตัว', icon: icons.profile }
  ];


  return (
    <aside
      className={`bg-white text-gray-700 flex flex-col border-r border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-800 shrink-0 fixed md:static inset-y-0 left-0 z-40 transform transition-all duration-300 md:translate-x-0 ${isCollapsed ? 'w-16' : 'w-56'
        } ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      {/* Header Bar with Logo and Toggle Button « / » */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/80">
        {!isCollapsed ? (
          <>
            {/* ชื่อระบบเป็นภาษาไทยเหมือนที่เขียนบนหน้าเข้าสู่ระบบ — ของเดิมเป็น
                "COOP EDU PORTAL" ตัวพิมพ์ใหญ่ ซึ่งไม่ตรงกับชื่อที่ใช้ที่อื่นในระบบเลย */}
            <span className="flex items-center gap-2 truncate text-sm font-extrabold text-brand-navy dark:text-white">
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10 12 5 2 10l10 5 10-5Z" />
                <path d="M6 12.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" />
              </svg>
              ระบบสหกิจศึกษา
            </span>
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="p-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
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
              className="p-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
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
        {activeMenuItems.map((item, index) => {
          const isActive = activeMenu === item.id;
          const lockReason = lockedMenus[item.id];
          // หัวข้อกลุ่มขึ้นเมื่อค่า group เปลี่ยนจากรายการก่อนหน้า · ตอนพับเมนูไม่มีที่ให้
          // ข้อความ จึงคั่นด้วยเส้นแทน ไม่งั้นทุกกลุ่มไหลติดกันเป็นแถวไอคอนยาวเหยียด
          const prevGroup = index > 0 ? activeMenuItems[index - 1].group : undefined;
          const startsGroup = !!item.group && item.group !== prevGroup;
          return (
            <React.Fragment key={`g-${item.id}`}>
            {startsGroup && (
              isCollapsed ? (
                <div className="my-2 border-t border-gray-200 dark:border-gray-800" aria-hidden="true" />
              ) : (
                <div className="px-3.5 pt-4 pb-1.5">
                  {/* gray-400 บนพื้น gray-900 — ตัวเดียวกับป้ายเมนูที่ไม่ได้เลือก
                      ซึ่งวัดได้ผ่าน AA อยู่แล้ว · gray-500/600 ตกเกณฑ์บนพื้นนี้ */}
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    {item.group}
                  </span>
                </div>
              )
            )}
            <button
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
                  ? 'bg-blue-50 text-brand-navy font-bold dark:bg-brand-blue dark:text-white dark:shadow-sm dark:shadow-blue-500/20'
                  // Locked items keep the same text colour as the rest.
                  // Greying the label to gray-600 put it at 2.35:1 on this
                  // sidebar — the padlock and the dimmed icon say "not yet"
                  // without making the words hard to read. (See the dark-mode
                  // round in CLAUDE.md: a disabled *look* is not a licence to
                  // drop below AA when the control is still clickable.)
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
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
            </React.Fragment>
          );
        })}
      </nav>

      {/* ⛔ ปุ่มออกจากระบบเคยอยู่ตรงนี้ — ย้ายไปอยู่ในเมนูใต้ชื่อผู้ใช้บนแถบบน (2026-09-07)
          เพราะร่างที่ตกลงกันไม่มีอะไรท้ายแถบเมนู · **ย้าย ไม่ใช่ลบ** และ
          `data-testid="logout"` ย้ายไปด้วยทั้งอัน helper `logout(page)` จึงยังใช้ได้ */}
    </aside>
  );
};

export default Sidebar;
