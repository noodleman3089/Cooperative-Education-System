import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Send, UserPlus, Upload } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Modal, { ModalBody } from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import PageSkeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { getErrorMessage } from '../../utils/errors';
import type {
  UserRow,
  PreseedPersonnelRow,
  MajorOption,
  FacultyRow,
  MajorRow,
} from '../../types/api';

/**
 * E7 · บัญชี สิทธิ์ และข้อมูลหลัก (UsersAndMasterData.dc.html)
 *
 * สามแท็บ: accounts (บัญชีผู้ใช้) · preseed (บุคลากรตั้งต้น) · master (คณะและสาขาวิชา)
 *
 * แท็บ master ต่อกับ SB7 (`POST|PUT|DELETE /api/master-data/faculties|majors`) —
 * ก่อนมีแท็บนี้ การแก้รายชื่อสาขาทำได้ทางเดียวคือเข้าไปรัน SQL กับฐานโดยตรง
 *
 * ⛔ **ข้อความปฏิเสธจากเซิร์ฟเวอร์ให้แสดงตรง ๆ อย่าเขียนทับ** — ตัวกันการลบสาขามีสามอย่าง
 *    (นักศึกษา · บุคลากร · ตำแหน่งงานที่ระบุสาขานั้น) แต่หน้าจอเห็นแค่จำนวนนักศึกษา
 *    ถ้าเขียนเหตุผลเองจะบอกผิดในสองกรณีที่เหลือ
 *
 * SEC-01: บุคลากรตั้งต้นที่ไม่มีอีเมล claim ไม่ได้ หน้าจอต้องขึ้นป้ายว่าแถวนั้นยังผูกบัญชีไม่ได้
 * SEC-03: บทบาท mentor ห้ามชนกับบทบาทอื่น
 * ปุ่ม "ส่งลิงก์เชิญใหม่" แสดงเฉพาะบัญชีสถานประกอบการ/พี่เลี้ยงที่ยังไม่ได้ตั้งรหัสเท่านั้น
 */

const ROLE_LABELS: Record<string, string> = {
  student: 'นักศึกษา',
  advisor: 'อาจารย์ที่ปรึกษา',
  dept_head: 'หัวหน้าสาขาวิชา',
  dean: 'คณบดี',
  staff: 'เจ้าหน้าที่',
  company: 'สถานประกอบการ',
  mentor: 'พี่เลี้ยง',
  admin: 'ผู้ดูแลระบบ',
};

export const UsersAndMasterData: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam === 'preseed' ? 'preseed' : tabParam === 'master' ? 'master' : 'accounts';

  const setActiveTab = (tab: 'accounts' | 'preseed' | 'master') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'accounts') next.delete('tab');
        else next.set('tab', tab);
        return next;
      },
      { replace: false }
    );
  };

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Pre-seed personnel states
  const [preseededPersonnel, setPreseededPersonnel] = useState<PreseedPersonnelRow[]>([]);
  const [loadingPreseed, setLoadingPreseed] = useState(false);
  const [majors, setMajors] = useState<MajorOption[]>([]);
  const [preseedEmployeeCode, setPreseedEmployeeCode] = useState('');
  const [preseedRoleName, setPreseedRoleName] = useState('advisor');
  const [preseedMajorId, setPreseedMajorId] = useState<number | ''>('');
  const [preseedFirstName, setPreseedFirstName] = useState('');
  const [preseedLastName, setPreseedLastName] = useState('');
  const [preseedEmail, setPreseedEmail] = useState('');
  const [preseedActiveSubTab, setPreseedActiveSubTab] = useState<'manual' | 'csv'>('manual');
  const [isUploadingPreseed, setIsUploadingPreseed] = useState(false);
  const [pendingDeletePreseed, setPendingDeletePreseed] = useState<PreseedPersonnelRow | null>(null);
  const [deletePreseedBusy, setDeletePreseedBusy] = useState(false);

  // แท็บคณะและสาขาวิชา (master)
  const [faculties, setFaculties] = useState<FacultyRow[]>([]);
  const [allMajors, setAllMajors] = useState<MajorRow[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [selectedFacultyId, setSelectedFacultyId] = useState<number | null>(null);
  /** `faculty_id` เป็น null = กำลังเพิ่มคณะใหม่ · มีค่า = กำลังแก้ชื่อคณะนั้น */
  const [facultyForm, setFacultyForm] = useState<{ faculty_id: number | null; name: string } | null>(
    null
  );
  const [facultyBusy, setFacultyBusy] = useState(false);
  const [majorForm, setMajorForm] = useState<{
    major_id: number | null;
    faculty_id: number;
    major_code: string;
    major_name_th: string;
  } | null>(null);
  const [majorBusy, setMajorBusy] = useState(false);
  /** error ของกล่อง — ต้องอยู่ในกล่อง ไม่ใช่แถบหลังกล่องที่ผู้ใช้มองไม่เห็น */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pendingDeleteMajor, setPendingDeleteMajor] = useState<MajorRow | null>(null);
  const [pendingDeleteFaculty, setPendingDeleteFaculty] = useState<FacultyRow | null>(null);
  const [facultyDeleteTyped, setFacultyDeleteTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Active User modals & editing
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userIsActive, setUserIsActive] = useState(true);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  const [resendingInvite, setResendingInvite] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // บุคลากรและสาขาสำหรับตรวจสอบหัวหน้าสาขาคนเดิม (SB-G2)
  const [personnelList, setPersonnelList] = useState<
    {
      personnel_id: number;
      major_id: number;
      major_name_th: string;
      first_name?: string | null;
      last_name?: string | null;
      email: string;
      roles: string[];
    }[]
  >([]);
  const [pendingDeptHeadReplace, setPendingDeptHeadReplace] = useState<{
    message: string;
  } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const [usersData, personnelData] = await Promise.all([
        api.get('/users'),
        api.get('/personnel'),
      ]);
      setUsers(usersData || []);
      setPersonnelList(personnelData || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadPreseedAndMajors = useCallback(async () => {
    try {
      setLoadingPreseed(true);
      const [preseedData, masterData] = await Promise.all([
        api.get('/personnel/preseed'),
        api.get('/master-data'),
      ]);
      setPreseededPersonnel(preseedData || []);
      setMajors(masterData.majors || []);
    } catch (err) {
      console.error('Failed to load preseed personnel or majors:', err);
    } finally {
      setLoadingPreseed(false);
    }
  }, []);

  /**
   * โหลดทะเบียนคณะ/สาขาสำหรับแท็บ master
   *
   * เลือกคณะแรกให้อัตโนมัติเมื่อยังไม่ได้เลือก หรือเมื่อคณะที่เลือกอยู่ถูกลบไปแล้ว —
   * ไม่งั้นตารางสาขาจะว่างโดยไม่มีเหตุผลที่ผู้ใช้เข้าใจได้
   */
  const loadMaster = useCallback(async () => {
    try {
      setLoadingMaster(true);
      const masterData = await api.get('/master-data');
      const nextFaculties: FacultyRow[] = masterData.faculties || [];
      setFaculties(nextFaculties);
      setAllMajors(masterData.majors || []);
      setSelectedFacultyId((current) =>
        current !== null && nextFaculties.some((f) => f.faculty_id === current)
          ? current
          : (nextFaculties[0]?.faculty_id ?? null)
      );
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดทะเบียนคณะและสาขาวิชาได้'));
    } finally {
      setLoadingMaster(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'accounts') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadUsers();
    } else if (activeTab === 'preseed') {
      loadPreseedAndMajors();
    } else {
      loadMaster();
    }
  }, [activeTab, loadUsers, loadPreseedAndMajors, loadMaster]);

  const handleResendInvite = async (userId: number, email: string) => {
    setError(null);
    setSuccess(null);
    setResendingInvite(userId);

    try {
      const res = await api.post(`/users/${userId}/resend-invite`);
      setSuccess(res.message || `ส่งลิงก์เชิญไปที่ ${email} เรียบร้อยแล้ว`);
    } catch (err) {
      console.error('Resend invite error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถส่งลิงก์เชิญได้'));
    } finally {
      setResendingInvite(null);
    }
  };

  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail || !userPassword || userRoles.length === 0) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    setIsSubmittingUser(true);
    setError(null);
    setSuccess(null);

    try {
      await api.post('/users', {
        email: userEmail,
        password: userPassword,
        roles: userRoles,
      });

      setSuccess(`สร้างบัญชีผู้ใช้ ${userEmail} สำเร็จเรียบร้อยแล้ว`);
      setIsAddUserModalOpen(false);
      setUserEmail('');
      setUserPassword('');
      setUserRoles([]);
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถสร้างบัญชีผู้ใช้ได้'));
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleEditUserClick = (user: UserRow) => {
    setSelectedUser(user);
    setUserEmail(user.email);
    setUserPassword('');
    setUserRoles(user.roles || []);
    setUserIsActive(user.is_active);
    setIsEditUserModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const executeEditUser = async () => {
    if (!selectedUser) return;

    setIsSubmittingUser(true);
    setError(null);
    setSuccess(null);
    setPendingDeptHeadReplace(null);

    try {
      const updateData: { email: string; roles: string[]; is_active: boolean; password?: string } = {
        email: userEmail || selectedUser.email,
        roles: userRoles,
        is_active: userIsActive,
      };
      if (userPassword.trim()) updateData.password = userPassword;

      const res = await api.put(`/users/${selectedUser.user_id}`, updateData);
      let successMsg = `อัปเดตข้อมูลบัญชี ${selectedUser.email} เรียบร้อยแล้ว`;
      if (res?.replaced_dept_heads && res.replaced_dept_heads.length > 0) {
        const replacedNames = res.replaced_dept_heads
          .map((h: { full_name: string }) => h.full_name)
          .join(', ');
        successMsg += ` (ถอดบทบาทหัวหน้าสาขาวิชาจาก ${replacedNames})`;
      }

      setSuccess(successMsg);
      setIsEditUserModalOpen(false);
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถแก้ไขข้อมูลผู้ใช้ได้'));
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleEditUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    // SB-G2: ตรวจสอบกรณีเพิ่มบทบาท dept_head ให้บัญชีที่ยังไม่เคยมีบทบาทนี้
    const isAddingDeptHead =
      userRoles.includes('dept_head') && !(selectedUser.roles || []).includes('dept_head');
    if (isAddingDeptHead) {
      const targetPersonnel = personnelList.find(
        (p) =>
          p.personnel_id === selectedUser.user_id ||
          p.email?.toLowerCase() === selectedUser.email.toLowerCase()
      );
      if (targetPersonnel?.major_id) {
        const existingHead = personnelList.find(
          (p) =>
            p.major_id === targetPersonnel.major_id &&
            p.personnel_id !== selectedUser.user_id &&
            (p.roles || []).includes('dept_head')
        );
        const majorName = targetPersonnel.major_name_th || 'นี้';
        if (existingHead) {
          const headName =
            [existingHead.first_name, existingHead.last_name].filter(Boolean).join(' ').trim() ||
            existingHead.email;
          setPendingDeptHeadReplace({
            message: `สาขา ${majorName} มีหัวหน้าสาขาอยู่แล้ว คือ ${headName} — บันทึกแล้ว ${headName} จะไม่ใช่หัวหน้าสาขาอีกต่อไป (บัญชีและหน้าที่อาจารย์ยังอยู่)`,
          });
          return;
        } else {
          setPendingDeptHeadReplace({
            message: 'ถ้าสาขานี้มีหัวหน้าสาขาอยู่ คนเดิมจะถูกถอดตำแหน่ง',
          });
          return;
        }
      } else {
        setPendingDeptHeadReplace({
          message: 'ถ้าสาขานี้มีหัวหน้าสาขาอยู่ คนเดิมจะถูกถอดตำแหน่ง',
        });
        return;
      }
    }

    await executeEditUser();
  };

  const handlePreseedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preseedEmployeeCode || !preseedFirstName || !preseedLastName) {
      setError('กรุณากรอกรหัสบุคลากร ชื่อ และนามสกุล');
      return;
    }
    // SEC-01: อีเมลคือสิ่งที่ผูกรหัสนี้กับคนคนเดียวตอน claim — เซิร์ฟเวอร์บังคับอยู่แล้ว
    // กันตั้งแต่ในฟอร์มด้วย จะได้ไม่ต้องกดแล้วค่อยเด้ง error กลับมา
    if (!preseedEmail.trim()) {
      setError('กรุณาระบุอีเมลของบุคลากร — เป็นสิ่งที่ผูกรหัสนี้กับบัญชีตอนยืนยันสิทธิ์ (SEC-01)');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      // ⛔ เส้นคือ `/personnel/add` ไม่ใช่ `/personnel/preseed` — `/preseed` มีแต่ GET กับ
      //    DELETE (ดู backend/src/routes/personnel.ts) · POST ไปที่นั่นได้ 404 เงียบ ๆ
      await api.post('/personnel/add', {
        employee_code: preseedEmployeeCode,
        role_name: preseedRoleName,
        major_id: preseedMajorId ? Number(preseedMajorId) : null,
        first_name: preseedFirstName,
        last_name: preseedLastName,
        email: preseedEmail.trim(),
      });

      setSuccess(`เพิ่มข้อมูลบุคลากรตั้งต้น ${preseedFirstName} ${preseedLastName} เรียบร้อยแล้ว`);
      setPreseedEmployeeCode('');
      setPreseedFirstName('');
      setPreseedLastName('');
      setPreseedEmail('');
      await loadPreseedAndMajors();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเพิ่มข้อมูลบุคลากรตั้งต้นได้'));
    }
  };

  const handlePreseedCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingPreseed(true);
    setError(null);
    setSuccess(null);

    try {
      const text = await file.text();
      // ⛔ เส้นคือ `/personnel/import` ไม่ใช่ `/personnel/preseed/import`
      const res = await api.post('/personnel/import', { csv: text });
      const s = res.summary ?? {};
      const imported = s.importedCount ?? 0;
      const updated = s.updatedCount ?? 0;
      const skipped = s.skippedCount ?? 0;
      const line = `เพิ่มใหม่ ${imported} คน · อัปเดต ${updated} คน · ตกไป ${skipped} แถว`;

      /**
       * ⛔ **ห้ามขึ้นว่า "สำเร็จ" เมื่อไม่มีแถวไหนเข้าเลย** — ตัวอ่าน CSV ฝั่งเซิร์ฟเวอร์
       *    ข้ามแถวที่รูปแบบไม่ตรงแบบเงียบ ๆ ไฟล์ที่เรียงคอลัมน์ผิดจึงได้ผลลัพธ์
       *    "เพิ่มใหม่ 0 คน" ซึ่งถ้าเขียนว่าสำเร็จ คนใช้จะเชื่อว่าลงไปแล้วทั้งไฟล์
       */
      if (imported === 0 && updated === 0) {
        setError(
          `ไม่มีแถวไหนถูกนำเข้าเลย (${line}) — ตรวจลำดับคอลัมน์ในไฟล์ให้ตรงกับที่ระบุใต้ปุ่มเลือกไฟล์`
        );
      } else if (skipped > 0) {
        setSuccess(`นำเข้าข้อมูลบุคลากรแล้ว: ${line} — แถวที่ตกไปคือแถวที่รูปแบบไม่ตรง`);
      } else {
        setSuccess(`นำเข้าข้อมูลบุคลากรเรียบร้อย: ${line}`);
      }
      await loadPreseedAndMajors();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถนำเข้าไฟล์ CSV ได้'));
    } finally {
      setIsUploadingPreseed(false);
      // เลือกไฟล์เดิมซ้ำต้องยิงใหม่ได้ — ไม่ล้างค่า input แล้ว onChange จะไม่ทำงานอีก
      e.target.value = '';
    }
  };

  /**
   * ลบรหัสบุคลากรตั้งต้นที่ยังไม่มีใคร claim
   *
   * ⛔ ความสามารถนี้มีมาแต่เดิม (`StaffDashboard.tsx` ก่อนแตกไฟล์) และหายไปตอน G0
   *    — รหัสที่พิมพ์ผิดแล้วลบไม่ได้ คือรหัสที่ค้างอยู่ในทะเบียนตลอดไป
   * ⛔ แถวที่ผูกบัญชีไปแล้วลบไม่ได้ (เซิร์ฟเวอร์ตอบ 400) หน้าจอจึง **ไม่แสดงปุ่ม**
   *    ให้แถวนั้นเลย ห้ามแสดงปุ่มที่กดแล้วได้ error
   */
  const handleDeletePreseed = async () => {
    if (!pendingDeletePreseed) return;
    setError(null);
    setSuccess(null);
    setDeletePreseedBusy(true);

    try {
      await api.delete(`/personnel/preseed/${encodeURIComponent(pendingDeletePreseed.employee_code)}`);
      setSuccess(`ลบรหัสบุคลากรตั้งต้น ${pendingDeletePreseed.employee_code} ออกจากรายชื่อแล้ว`);
      setPendingDeletePreseed(null);
      await loadPreseedAndMajors();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถลบข้อมูลบุคลากรตั้งต้นได้'));
    } finally {
      setDeletePreseedBusy(false);
    }
  };

  /* ── แท็บคณะและสาขาวิชา (SB7) ──────────────────────────────────────── */

  const handleFacultySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facultyForm) return;
    const name = facultyForm.name.trim();
    if (!name) {
      setDialogError('กรุณากรอกชื่อคณะ');
      return;
    }

    setDialogError(null);
    setSuccess(null);
    setFacultyBusy(true);
    try {
      if (facultyForm.faculty_id === null) {
        const created = await api.post('/master-data/faculties', { faculty_name_th: name });
        setSuccess(`เพิ่มคณะ “${created.faculty_name_th}” เรียบร้อยแล้ว`);
        setSelectedFacultyId(created.faculty_id);
      } else {
        const updated = await api.put(`/master-data/faculties/${facultyForm.faculty_id}`, {
          faculty_name_th: name,
        });
        setSuccess(`เปลี่ยนชื่อคณะเป็น “${updated.faculty_name_th}” เรียบร้อยแล้ว`);
      }
      setFacultyForm(null);
      await loadMaster();
    } catch (err) {
      // ข้อความซ้ำชื่อจากเซิร์ฟเวอร์บอกว่าชนกับคณะไหน — เอามาแสดงตรง ๆ
      setDialogError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลคณะได้'));
    } finally {
      setFacultyBusy(false);
    }
  };

  const handleMajorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!majorForm) return;
    const code = majorForm.major_code.trim();
    const name = majorForm.major_name_th.trim();
    if (!code || !name) {
      setDialogError('กรุณากรอกทั้งรหัสสาขาและชื่อสาขาวิชา');
      return;
    }

    setDialogError(null);
    setSuccess(null);
    setMajorBusy(true);
    try {
      const body = {
        faculty_id: majorForm.faculty_id,
        major_code: code,
        major_name_th: name,
      };
      if (majorForm.major_id === null) {
        const created = await api.post('/master-data/majors', body);
        setSuccess(`เพิ่มสาขา “${created.major_name_th}” (${created.major_code}) เรียบร้อยแล้ว`);
      } else {
        const updated = await api.put(`/master-data/majors/${majorForm.major_id}`, body);
        setSuccess(`บันทึกสาขา “${updated.major_name_th}” (${updated.major_code}) เรียบร้อยแล้ว`);
      }
      setMajorForm(null);
      await loadMaster();
    } catch (err) {
      // รหัสซ้ำ: เซิร์ฟเวอร์บอกว่าซ้ำกับสาขาไหน ไม่ใช่ “รหัสซ้ำ” ลอย ๆ
      setDialogError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลสาขาวิชาได้'));
    } finally {
      setMajorBusy(false);
    }
  };

  const handleDeleteMajor = async () => {
    if (!pendingDeleteMajor) return;
    setDialogError(null);
    setSuccess(null);
    setDeleteBusy(true);
    try {
      const res = await api.delete(`/master-data/majors/${pendingDeleteMajor.major_id}`);
      setSuccess(res?.message || `ลบสาขา “${pendingDeleteMajor.major_name_th}” เรียบร้อยแล้ว`);
      setPendingDeleteMajor(null);
      await loadMaster();
    } catch (err) {
      /**
       * ⛔ 409 ที่นี่คือตัวกันสามอย่าง (นักศึกษา · บุคลากร · ตำแหน่งงาน) ที่หน้าจอ
       *    มองเห็นแค่อย่างเดียว · แสดงข้อความของเซิร์ฟเวอร์ ห้ามสรุปเองว่า “มีนักศึกษาสังกัด”
       *
       * และแสดง**ในกล่อง** ไม่ใช่แถบบนสุดของหน้า — ตารางสาขาอยู่ต่ำกว่าจอไปแล้ว
       * คำตอบที่ไปโผล่บนสุดเท่ากับกดแล้วไม่มีอะไรเกิดขึ้นในสายตาผู้ใช้
       */
      setDialogError(getErrorMessage(err, 'ไม่สามารถลบสาขาวิชาได้'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDeleteFaculty = async () => {
    if (!pendingDeleteFaculty) return;
    setError(null);
    setSuccess(null);
    setDeleteBusy(true);
    try {
      const res = await api.delete(`/master-data/faculties/${pendingDeleteFaculty.faculty_id}`);
      setSuccess(res?.message || `ลบคณะ “${pendingDeleteFaculty.faculty_name_th}” เรียบร้อยแล้ว`);
      setPendingDeleteFaculty(null);
      setFacultyDeleteTyped('');
      await loadMaster();
    } catch (err) {
      setDialogError(getErrorMessage(err, 'ไม่สามารถลบคณะได้'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const majorsOfSelected = allMajors.filter((m) => m.faculty_id === selectedFacultyId);
  const selectedFaculty = faculties.find((f) => f.faculty_id === selectedFacultyId) ?? null;
  /** สาขาที่จะหายไปพร้อมคณะ — ต้องลิสต์ชื่อให้ครบก่อนถาม ไม่ใช่บอกแค่จำนวน */
  const majorsOfPendingDelete = pendingDeleteFaculty
    ? allMajors.filter((m) => m.faculty_id === pendingDeleteFaculty.faculty_id)
    : [];

  const getLoginMethod = (u: UserRow) => {
    const isCompanyOrMentor = (u.roles || []).some((r) => r === 'company' || r === 'mentor');
    if (!isCompanyOrMentor) return 'Google (มหาวิทยาลัย)';
    if (u.is_invited && !u.is_password_set) return 'ลิงก์เชิญ · ยังไม่ได้ตั้งรหัส';
    return 'ลิงก์เชิญ · ตั้งรหัสแล้ว';
  };

  return (
    <div className="max-w-[1360px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching UsersAndMasterData.dc.html */}
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          บัญชี สิทธิ์ และข้อมูลหลัก
        </h1>
        <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
          รวมสามอย่างที่เจ้าหน้าที่เป็นเจ้าของไว้ที่เดียว — บัญชีผู้ใช้ · รายชื่อบุคลากรตั้งต้น · <strong className="font-bold text-gray-800 dark:text-gray-200">คณะและสาขาวิชา</strong>
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 2. Tab Bar matching UsersAndMasterData.dc.html */}
      <div className="flex items-center gap-6 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          data-testid="users-tab-accounts"
          onClick={() => setActiveTab('accounts')}
          className={`py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'accounts'
              ? 'border-blue-600 text-blue-900 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          บัญชีผู้ใช้
        </button>
        <button
          type="button"
          data-testid="users-tab-preseed"
          onClick={() => setActiveTab('preseed')}
          className={`py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'preseed'
              ? 'border-blue-600 text-blue-900 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          บุคลากรตั้งต้น
        </button>
        <button
          type="button"
          data-testid="users-tab-master"
          onClick={() => setActiveTab('master')}
          className={`py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'master'
              ? 'border-blue-600 text-blue-900 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          คณะและสาขาวิชา
        </button>
      </div>

      {/* Tab 1: บัญชีผู้ใช้ (accounts) */}
      {activeTab === 'accounts' && (
        <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden space-y-0">
          <div className="p-4 sm:px-5 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50 dark:bg-gray-700/30">
            <div>
              <span className="text-[16px] font-bold text-gray-900 dark:text-white block">
                แท็บ “บัญชีผู้ใช้”
              </span>
              <span className="hint text-xs text-gray-500 dark:text-gray-400">
                จัดการสิทธิ์และติดตามสถานะการเปิดใช้งานบัญชีทั้งหมด {users.length} บัญชี
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setUserEmail('');
                setUserPassword('');
                setUserRoles(['student']);
                setIsAddUserModalOpen(true);
              }}
              className="btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> เพิ่มบัญชี
            </button>
          </div>

          {loadingUsers ? (
            <div className="p-8"><PageSkeleton variant="table" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300">
                    <th className="p-3 sm:px-4">อีเมล</th>
                    <th className="p-3 sm:px-4">บทบาท</th>
                    <th className="p-3 sm:px-4">วิธีเข้าระบบ</th>
                    <th className="p-3 sm:px-4">สถานะ</th>
                    <th className="p-3 sm:px-4 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-xs">
                  {users.map((u) => {
                    const isCompanyOrMentor = (u.roles || []).some((r) => r === 'company' || r === 'mentor');
                    const isPendingInvite = isCompanyOrMentor && u.is_invited && !u.is_password_set;

                    return (
                      <tr
                        key={u.user_id}
                        data-testid={`user-row-${u.user_id}`}
                        className={`hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors ${
                          isPendingInvite ? 'bg-[#FFFBEB] dark:bg-amber-950/20' : ''
                        }`}
                      >
                        <td className="p-3 sm:px-4 font-mono font-medium text-gray-900 dark:text-white">
                          {u.email}
                        </td>
                        <td className="p-3 sm:px-4">
                          <div className="flex flex-wrap gap-1">
                            {(u.roles || []).map((r) => (
                              <span
                                key={r}
                                className="rolechip inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-[#EFF6FF] text-[#1E3A8A] dark:bg-blue-950/60 dark:text-blue-300"
                              >
                                {ROLE_LABELS[r] || r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 sm:px-4">
                          {isPendingInvite ? (
                            <span className="text-amber-800 dark:text-amber-300 font-semibold">
                              ลิงก์เชิญ · ยังไม่ได้ตั้งรหัส
                            </span>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-300">
                              {getLoginMethod(u)}
                            </span>
                          )}
                        </td>
                        <td className="p-3 sm:px-4">
                          {isPendingInvite ? (
                            <span className="pill px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-[#FFFBEB] text-[#B45309] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                              รอเปิดใช้งาน
                            </span>
                          ) : u.is_active ? (
                            <span className="pill px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                              ใช้งานอยู่
                            </span>
                          ) : (
                            <span className="pill px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              ปิดการใช้งาน
                            </span>
                          )}
                        </td>
                        <td className="p-3 sm:px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* ปุ่มส่งลิงก์เชิญใหม่ แสดงเฉพาะบัญชีสถานประกอบการ/พี่เลี้ยงที่ยังไม่ได้ตั้งรหัส */}
                            {isPendingInvite && (
                              <button
                                type="button"
                                data-testid={`user-resend-invite-${u.user_id}`}
                                onClick={() => handleResendInvite(u.user_id, u.email)}
                                disabled={resendingInvite === u.user_id}
                                className="btn px-2.5 py-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50"
                              >
                                <Send className="w-3 h-3" />
                                {resendingInvite === u.user_id ? 'กำลังส่ง...' : 'ส่งลิงก์เชิญใหม่'}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleEditUserClick(u)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              แก้ไข
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="p-4 sm:px-5 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 leading-relaxed bg-gray-50/30 dark:bg-gray-800/20 space-y-1">
            <p>
              คนนอกเข้าระบบด้วย <strong className="font-bold text-gray-800 dark:text-gray-200">ลิงก์เชิญใช้ครั้งเดียว อายุ 48 ชม.</strong> ไม่ใช่รหัสผ่านที่ส่งทางเมล · ปุ่ม “ส่งลิงก์เชิญใหม่” ใช้ได้เฉพาะบัญชีสถานประกอบการและพี่เลี้ยง — นักศึกษาและบุคลากรใช้ Google จึงถูกปฏิเสธโดยตั้งใจ
            </p>
            <p>
              ⛔ แปะบทบาท “พี่เลี้ยง” ทับบัญชีที่มีบทบาทอื่นอยู่แล้วไม่ได้ ระบบตอบปฏิเสธพร้อมบอกให้ใช้อีเมลอื่น
            </p>
          </div>
        </div>
      )}

      {/* Tab 2: บุคลากรตั้งต้น (preseed) */}
      {activeTab === 'preseed' && (
        <div className="space-y-4">
          <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  รายชื่อบุคลากรตั้งต้น (Preseed Personnel)
                </h3>
                <p className="hint text-xs text-gray-500 dark:text-gray-400">
                  รายชื่ออาจารย์และหัวหน้าสาขาวิชาที่รอให้อาจารย์เข้าสู่ระบบด้วย Google เพื่อผูกบัญชี (Claim)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreseedActiveSubTab('manual')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    preseedActiveSubTab === 'manual'
                      ? 'bg-blue-50 border-blue-600 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'
                  }`}
                >
                  เพิ่มรายคน
                </button>
                <button
                  type="button"
                  onClick={() => setPreseedActiveSubTab('csv')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    preseedActiveSubTab === 'csv'
                      ? 'bg-blue-50 border-blue-600 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'
                  }`}
                >
                  นำเข้า CSV
                </button>
              </div>
            </div>

            {/* Form */}
            {preseedActiveSubTab === 'manual' ? (
              <form onSubmit={handlePreseedSubmit} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50/50 dark:bg-gray-800/30">
                <div>
                  <label htmlFor="preseed-code" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    รหัสบุคลากร *
                  </label>
                  <input
                    id="preseed-code"
                    type="text"
                    value={preseedEmployeeCode}
                    onChange={(e) => setPreseedEmployeeCode(e.target.value)}
                    placeholder="เช่น EMP001"
                    className="w-full text-xs px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="preseed-fname" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    ชื่อ *
                  </label>
                  <input
                    id="preseed-fname"
                    type="text"
                    value={preseedFirstName}
                    onChange={(e) => setPreseedFirstName(e.target.value)}
                    className="w-full text-xs px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="preseed-lname" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    นามสกุล *
                  </label>
                  <input
                    id="preseed-lname"
                    type="text"
                    value={preseedLastName}
                    onChange={(e) => setPreseedLastName(e.target.value)}
                    className="w-full text-xs px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="preseed-role" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    บทบาท
                  </label>
                  <select
                    id="preseed-role"
                    value={preseedRoleName}
                    onChange={(e) => setPreseedRoleName(e.target.value)}
                    className="w-full text-xs px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="advisor">อาจารย์ที่ปรึกษา (Advisor)</option>
                    <option value="dept_head">หัวหน้าสาขาวิชา (Dept Head)</option>
                    <option value="dean">คณบดี (Dean)</option>
                    <option value="staff">เจ้าหน้าที่ (Staff)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="preseed-major" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    สาขาวิชา
                  </label>
                  <select
                    id="preseed-major"
                    value={preseedMajorId}
                    onChange={(e) => setPreseedMajorId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-xs px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">— ไม่สังกัดสาขาวิชา —</option>
                    {majors.map((m) => (
                      <option key={m.major_id} value={m.major_id}>
                        {m.major_name_th} {m.major_code ? `(${m.major_code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="preseed-email" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    อีเมลมหาวิทยาลัย * (SEC-01)
                  </label>
                  {/* ⛔ บังคับ — เซิร์ฟเวอร์ปฏิเสธแถวที่ไม่มีอีเมลอยู่แล้ว เพราะมันคือสิ่งเดียว
                      ที่ผูกรหัสนี้กับคนคนเดียวตอน claim · กันที่ฟอร์มด้วยจะได้ไม่ต้องกดแล้วเด้ง */}
                  <input
                    id="preseed-email"
                    type="email"
                    value={preseedEmail}
                    onChange={(e) => setPreseedEmail(e.target.value)}
                    placeholder="advisor@rmutto.ac.th"
                    className="w-full text-xs px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    required
                  />
                </div>
                <div className="sm:col-span-2 md:col-span-3 flex justify-end">
                  <button
                    type="submit"
                    className="btn inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> เพิ่มบุคลากรตั้งต้น
                  </button>
                </div>
              </form>
            ) : (
              <div className="border-2 border-dashed rounded-xl p-6 text-center space-y-2">
                <Upload className="w-6 h-6 text-blue-600 mx-auto" />
                {/*
                  ⛔ ตัวอ่านฝั่งเซิร์ฟเวอร์อ่าน **ตามตำแหน่งคอลัมน์** ไม่ได้อ่านจากชื่อหัวตาราง
                     (`controllers/personnelImport.ts` — `line.split(',')` แล้วหยิบ parts[0..5])
                     ลำดับผิดเมื่อไหร่ แถวนั้นถูกข้ามเงียบ ๆ ไม่มีข้อความบอกว่าเพราะอะไร
                     ข้อความนี้จึงต้องตรงกับลำดับจริงเป๊ะ ๆ — เคยเขียนผิดมาแล้วรอบหนึ่ง
                */}
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  เลือกไฟล์ CSV — <strong className="font-bold">เรียงคอลัมน์ตามลำดับนี้เท่านั้น</strong>
                  <br />
                  <code className="text-[11px]">
                    employee_code, role_name, major_id, first_name, last_name, email
                  </code>
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  <code>role_name</code> ต้องเป็น advisor · dept_head · dean · staff เท่านั้น
                  · <code>major_id</code> เว้นว่างได้ (เช่นคณบดี) · <code>email</code> คือช่องที่ผูกรหัสกับบัญชีตอน claim
                  <br />
                  มีหัวตารางบรรทัดแรกหรือไม่มีก็ได้ · แถวที่รูปแบบไม่ตรงจะถูกข้ามและนับไว้ใน “ตกไป”
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handlePreseedCsvUpload}
                  disabled={isUploadingPreseed}
                  className="text-xs text-gray-500"
                />
              </div>
            )}

            {/* Table */}
            {loadingPreseed ? (
              <PageSkeleton variant="table" />
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-bold">
                    <tr>
                      <th className="p-3">รหัส</th>
                      <th className="p-3">ชื่อ - นามสกุล</th>
                      <th className="p-3">บทบาท</th>
                      <th className="p-3">สาขาวิชา</th>
                      <th className="p-3">อีเมล</th>
                      <th className="p-3">สถานะ Claim (SEC-01)</th>
                      <th className="p-3 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-gray-800 dark:text-gray-200">
                    {preseededPersonnel.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-gray-400">
                          ยังไม่มีข้อมูลบุคลากรตั้งต้น
                        </td>
                      </tr>
                    ) : (
                      preseededPersonnel.map((p) => {
                        const hasNoEmail = !p.email;
                        return (
                          <tr key={p.preseed_id || p.employee_code} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/20">
                            <td className="p-3 font-mono font-semibold">{p.employee_code}</td>
                            <td className="p-3">{p.first_name} {p.last_name}</td>
                            <td className="p-3">
                              <span className="rolechip px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                                {ROLE_LABELS[p.role_name] || p.role_name}
                              </span>
                            </td>
                            <td className="p-3">{p.major_name_th || '—'}</td>
                            <td className="p-3 font-mono">
                              {p.email || <span className="text-red-600 font-semibold">— ไม่มีอีเมล</span>}
                            </td>
                            <td className="p-3">
                              {p.is_claimed ? (
                                <span className="pill px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                  ผูกบัญชีแล้ว
                                </span>
                              ) : hasNoEmail ? (
                                <span className="pill px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                                  ยังผูกบัญชีไม่ได้ (ไม่มีอีเมล)
                                </span>
                              ) : (
                                <span className="pill px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                  รออาจารย์เข้าสู่ระบบ
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {/* ⛔ แถวที่ผูกบัญชีแล้วลบไม่ได้ (เซิร์ฟเวอร์ตอบ 400)
                                  จึงไม่แสดงปุ่มเลย ห้ามแสดงปุ่มที่กดแล้วได้ error */}
                              {p.is_claimed ? (
                                <span className="text-[11px] text-gray-400">—</span>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`preseed-delete-${p.employee_code}`}
                                  onClick={() => setPendingDeletePreseed(p)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                >
                                  ลบรหัสนี้
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: คณะและสาขาวิชา (master) — SB7 */}
      {activeTab === 'master' && (
        <div className="space-y-4">
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            ก่อนหน้านี้แก้รายชื่อสาขาได้ทางเดียวคือเข้าไปแก้ในฐานข้อมูลตรง ๆ · การเพิ่ม/แก้/ลบ คณะและสาขาอยู่บนหน้าจอนี้แล้ว
            <span className="block mt-0.5 text-gray-500 dark:text-gray-400">
              ⛔ การย้ายนักศึกษารายคนไปสาขาอื่น <strong className="font-bold">ไม่ได้ทำที่นี่</strong> — ทำที่หน้า “รายชื่อนักศึกษา &amp; เกรด”
            </span>
          </p>

          {loadingMaster && faculties.length === 0 ? (
            <PageSkeleton variant="table" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
              {/* ── รายชื่อคณะ ── */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-100">คณะ</span>
                  <button
                    type="button"
                    data-testid="master-faculty-add"
                    onClick={() => {
                      setDialogError(null);
                      setFacultyForm({ faculty_id: null, name: '' });
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    เพิ่มคณะ
                  </button>
                </div>

                {faculties.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="ยังไม่มีคณะในทะเบียน"
                      description="ทะเบียนคณะว่างอยู่จริง ไม่ใช่ตัวกรองซ่อนไว้ — กด “เพิ่มคณะ” เพื่อสร้างคณะแรก แล้วจึงเพิ่มสาขาใต้คณะนั้น"
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {faculties.map((f) => {
                      const on = f.faculty_id === selectedFacultyId;
                      return (
                        <li key={f.faculty_id} data-testid={`master-faculty-row-${f.faculty_id}`}>
                          <div
                            className={`flex items-start gap-2 px-4 py-3 ${
                              on
                                ? 'bg-blue-50 dark:bg-blue-950/30'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedFacultyId(f.faculty_id)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <span
                                className={`block text-[13px] font-bold truncate ${
                                  on
                                    ? 'text-blue-900 dark:text-blue-300'
                                    : 'text-gray-800 dark:text-gray-100'
                                }`}
                              >
                                {f.faculty_name_th}
                              </span>
                              <span className="block mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                                {f.major_count ?? 0} สาขาวิชา · นักศึกษา {f.student_count ?? 0} คน
                              </span>
                            </button>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                data-testid={`master-faculty-edit-${f.faculty_id}`}
                                onClick={() => {
                                  setDialogError(null);
                                  setFacultyForm({
                                    faculty_id: f.faculty_id,
                                    name: f.faculty_name_th,
                                  });
                                }}
                                className="px-2 py-1 rounded-lg text-[11px] font-bold border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                              >
                                แก้ชื่อ
                              </button>
                              <button
                                type="button"
                                data-testid={`master-faculty-delete-${f.faculty_id}`}
                                onClick={() => {
                                  setDialogError(null);
                                  setFacultyDeleteTyped('');
                                  setPendingDeleteFaculty(f);
                                }}
                                className="px-2 py-1 rounded-lg text-[11px] font-bold border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                              >
                                ลบ
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* ── สาขาวิชาในคณะที่เลือก ── */}
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">
                    {selectedFaculty
                      ? `สาขาวิชาใน${selectedFaculty.faculty_name_th}`
                      : 'สาขาวิชา'}
                  </span>
                  {selectedFaculty && (
                    <button
                      type="button"
                      data-testid="master-major-add"
                      onClick={() => {
                        setDialogError(null);
                        setMajorForm({
                          major_id: null,
                          faculty_id: selectedFaculty.faculty_id,
                          major_code: '',
                          major_name_th: '',
                        });
                      }}
                      className="inline-flex shrink-0 items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      เพิ่มสาขาวิชา
                    </button>
                  )}
                </div>

                {!selectedFaculty ? (
                  <div className="p-5">
                    <EmptyState
                      title="ยังไม่ได้เลือกคณะ"
                      description="เลือกคณะจากรายการทางซ้ายเพื่อดูและแก้ไขสาขาวิชาใต้คณะนั้น"
                    />
                  </div>
                ) : majorsOfSelected.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="คณะนี้ยังไม่มีสาขาวิชา"
                      description="ว่างเพราะยังไม่เคยเพิ่ม ไม่ใช่เพราะตัวกรอง — กด “เพิ่มสาขาวิชา” เพื่อสร้างสาขาแรกของคณะนี้"
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-600 dark:text-gray-400">
                          <th className="p-3 sm:px-4">รหัสสาขา</th>
                          <th className="p-3 sm:px-4">ชื่อสาขาวิชา</th>
                          <th className="p-3 sm:px-4">นักศึกษาที่สังกัด</th>
                          <th className="p-3 sm:px-4 text-right">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {majorsOfSelected.map((m) => {
                          const students = m.student_count ?? 0;
                          return (
                            <tr
                              key={m.major_id}
                              data-testid={`master-major-row-${m.major_id}`}
                              className="hover:bg-gray-50 dark:hover:bg-gray-700/40"
                            >
                              <td className="p-3 sm:px-4 text-xs font-mono text-gray-700 dark:text-gray-300">
                                {m.major_code}
                              </td>
                              <td className="p-3 sm:px-4 text-xs font-semibold text-gray-800 dark:text-gray-100">
                                {m.major_name_th}
                              </td>
                              <td className="p-3 sm:px-4 text-xs text-gray-700 dark:text-gray-300">
                                {students > 0 ? `${students} คน` : '—'}
                              </td>
                              <td className="p-3 sm:px-4">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    data-testid={`master-major-edit-${m.major_id}`}
                                    onClick={() => {
                                      setDialogError(null);
                                      setMajorForm({
                                        major_id: m.major_id,
                                        faculty_id: m.faculty_id,
                                        major_code: m.major_code,
                                        major_name_th: m.major_name_th,
                                      });
                                    }}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                                  >
                                    แก้ไข
                                  </button>
                                  {/*
                                    นักศึกษาสังกัดอยู่ = ปิดปุ่มตั้งแต่บนจอ พร้อมบอกจำนวน
                                    (สเปกข้อ 10.1) · ตัวกันอีกสองอย่างมองไม่เห็นจากตรงนี้
                                    ปุ่มจึงยังกดได้ในกรณีนั้น แล้วแสดงเหตุผลจากเซิร์ฟเวอร์
                                  */}
                                  {students > 0 ? (
                                    <span
                                      data-testid={`master-major-delete-blocked-${m.major_id}`}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400"
                                      title={`ลบไม่ได้ — มีนักศึกษาสังกัดอยู่ ${students} คน`}
                                    >
                                      ลบไม่ได้ · {students} คนสังกัด
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      data-testid={`master-major-delete-${m.major_id}`}
                                      onClick={() => {
                                        setDialogError(null);
                                        setPendingDeleteMajor(m);
                                      }}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                    >
                                      ลบ
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: เพิ่ม/แก้ชื่อคณะ */}
      {facultyForm && (
        <Modal
          onClose={() => setFacultyForm(null)}
          title={facultyForm.faculty_id === null ? 'เพิ่มคณะ' : 'แก้ชื่อคณะ'}
          closeOnBackdrop={false}
        >
          <ModalBody>
            <form onSubmit={handleFacultySubmit} className="space-y-4">
              <AlertBanner variant="error" message={dialogError} />
              <div>
                <label
                  htmlFor="master-faculty-name"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                >
                  ชื่อคณะ (ภาษาไทย) *
                </label>
                <input
                  id="master-faculty-name"
                  type="text"
                  value={facultyForm.name}
                  onChange={(e) => setFacultyForm({ ...facultyForm, name: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-gray-300 rounded-xl bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                />
                {facultyForm.faculty_id !== null && (
                  <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    เปลี่ยนชื่อคณะมีผลกับทุกสาขาใต้คณะทันที · ไม่ได้ย้ายสาขาไปคณะอื่น
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFacultyForm(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  data-testid="master-faculty-save"
                  disabled={facultyBusy}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  {facultyBusy ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </ModalBody>
        </Modal>
      )}

      {/* Modal: เพิ่ม/แก้ไขสาขาวิชา */}
      {majorForm && (
        <Modal
          onClose={() => setMajorForm(null)}
          title={majorForm.major_id === null ? 'เพิ่มสาขาวิชา' : 'แก้ไขสาขาวิชา'}
          closeOnBackdrop={false}
        >
          <ModalBody>
            <form onSubmit={handleMajorSubmit} className="space-y-4">
              <AlertBanner variant="error" message={dialogError} />
              <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                รหัสสาขาต้องไม่ซ้ำทั้งระบบ · ถ้าซ้ำ ระบบจะบอกว่าชนกับสาขาไหน
              </p>
              <div>
                <label
                  htmlFor="master-major-code"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                >
                  รหัสสาขา *
                </label>
                <input
                  id="master-major-code"
                  type="text"
                  value={majorForm.major_code}
                  onChange={(e) => setMajorForm({ ...majorForm, major_code: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-gray-300 rounded-xl bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="master-major-name"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                >
                  ชื่อสาขาวิชา (ภาษาไทย) *
                </label>
                <input
                  id="master-major-name"
                  type="text"
                  value={majorForm.major_name_th}
                  onChange={(e) => setMajorForm({ ...majorForm, major_name_th: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-gray-300 rounded-xl bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="master-major-faculty"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                >
                  สังกัดคณะ *
                </label>
                <select
                  id="master-major-faculty"
                  value={majorForm.faculty_id}
                  onChange={(e) =>
                    setMajorForm({ ...majorForm, faculty_id: Number(e.target.value) })
                  }
                  className="w-full text-xs px-3 py-2 border border-gray-300 rounded-xl bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  {faculties.map((f) => (
                    <option key={f.faculty_id} value={f.faculty_id}>
                      {f.faculty_name_th}
                    </option>
                  ))}
                </select>
                {majorForm.major_id !== null && (
                  <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    เปลี่ยนคณะที่สังกัด = ย้ายทั้งสาขาไปอยู่ใต้คณะใหม่ พร้อมนักศึกษาที่สังกัดสาขานี้
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMajorForm(null)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  data-testid="master-major-save"
                  disabled={majorBusy}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  {majorBusy ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </ModalBody>
        </Modal>
      )}

      {/* Modal: ลบคณะ — ระดับ 3 ต้องพิมพ์ชื่อคณะยืนยัน */}
      {pendingDeleteFaculty && (
        <Modal
          onClose={() => {
            setPendingDeleteFaculty(null);
            setFacultyDeleteTyped('');
          }}
          title={`ลบคณะ “${pendingDeleteFaculty.faculty_name_th}”`}
          closeOnBackdrop={false}
        >
          <ModalBody>
            <div className="space-y-4">
              <AlertBanner variant="error" message={dialogError} />
              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                การลบคณะจะ{' '}
                <strong className="font-bold text-gray-900 dark:text-white">
                  ลบสาขาวิชาใต้คณะทั้งหมด {majorsOfPendingDelete.length} สาขา
                </strong>{' '}
                ไปด้วย:
              </p>
              {majorsOfPendingDelete.length === 0 ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  คณะนี้ยังไม่มีสาขาวิชาใต้คณะ
                </p>
              ) : (
                <ul className="space-y-1 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                  {majorsOfPendingDelete.map((m) => (
                    <li key={m.major_id} className="text-xs text-gray-700 dark:text-gray-300">
                      • <span className="font-mono">{m.major_code}</span> {m.major_name_th}
                      {(m.student_count ?? 0) > 0 && (
                        <span className="text-red-700 dark:text-red-300">
                          {' '}
                          — มีนักศึกษาสังกัด {m.student_count} คน
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <label
                  htmlFor="master-faculty-delete-typed"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                >
                  พิมพ์ชื่อคณะเพื่อยืนยัน
                </label>
                <input
                  id="master-faculty-delete-typed"
                  type="text"
                  value={facultyDeleteTyped}
                  onChange={(e) => setFacultyDeleteTyped(e.target.value)}
                  placeholder={pendingDeleteFaculty.faculty_name_th}
                  className="w-full text-xs px-3 py-2 border border-gray-300 rounded-xl bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPendingDeleteFaculty(null);
                    setFacultyDeleteTyped('');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  data-testid="master-faculty-delete-confirm"
                  onClick={handleDeleteFaculty}
                  disabled={
                    deleteBusy ||
                    facultyDeleteTyped.trim() !== pendingDeleteFaculty.faculty_name_th
                  }
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleteBusy ? 'กำลังลบ...' : 'ยืนยันลบทั้งคณะ'}
                </button>
              </div>
            </div>
          </ModalBody>
        </Modal>
      )}

      <ConfirmDialog
        open={pendingDeleteMajor !== null}
        title="ยืนยันการลบสาขาวิชา"
        message={
          pendingDeleteMajor ? (
            <span className="block space-y-2">
              <span className="block">
                ต้องการลบสาขา “{pendingDeleteMajor.major_name_th}” ({pendingDeleteMajor.major_code})
                ออกจากทะเบียนใช่หรือไม่? สาขานี้จะหายจากตัวเลือกในหน้าสมัครและหน้าตั้งค่าทั้งหมดทันที
              </span>
              {dialogError && (
                <span className="block rounded-xl border border-red-200 bg-red-50 p-2.5 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                  {dialogError}
                </span>
              )}
            </span>
          ) : (
            ''
          )
        }
        confirmLabel="ลบสาขาวิชา"
        confirmTestId="master-major-delete-confirm"
        destructive
        busy={deleteBusy}
        onConfirm={handleDeleteMajor}
        onCancel={() => {
          setPendingDeleteMajor(null);
          setDialogError(null);
        }}
      />

      {/* Modal: เพิ่มบัญชีผู้ใช้ใหม่ */}
      {isAddUserModalOpen && (
        <Modal
          onClose={() => setIsAddUserModalOpen(false)}
          title="เพิ่มบัญชีผู้ใช้ใหม่"
        >
          <ModalBody>
            <form onSubmit={handleAddUserSubmit} className="space-y-4">
              <div>
                <label htmlFor="modal-add-email" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  อีเมล *
                </label>
                <input
                  id="modal-add-email"
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="name@rmutto.ac.th หรือ อีเมลบริษัท"
                  className="w-full text-xs px-3 py-2 border rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label htmlFor="modal-add-password" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  รหัสผ่านเริ่มต้น *
                </label>
                <input
                  id="modal-add-password"
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  className="w-full text-xs px-3 py-2 border rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  บทบาทในระบบ *
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(ROLE_LABELS).map(([k, lbl]) => (
                    <label key={k} className="inline-flex items-center gap-2 cursor-pointer text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={userRoles.includes(k)}
                        onChange={(e) => {
                          if (e.target.checked) setUserRoles([...userRoles, k]);
                          else setUserRoles(userRoles.filter((r) => r !== k));
                        }}
                      />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingUser}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  {isSubmittingUser ? 'กำลังบันทึก...' : 'สร้างบัญชี'}
                </button>
              </div>
            </form>
          </ModalBody>
        </Modal>
      )}

      {/* Modal: แก้ไขบัญชีผู้ใช้ */}
      {isEditUserModalOpen && (
        <Modal
          onClose={() => setIsEditUserModalOpen(false)}
          title={`แก้ไขบัญชี: ${selectedUser?.email}`}
        >
          <ModalBody>
            <form onSubmit={handleEditUserSubmit} className="space-y-4">
              <div>
                <label htmlFor="modal-edit-password" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  รหัสผ่านใหม่ (เว้นว่างไว้หากไม่ต้องการเปลี่ยน)
                </label>
                <input
                  id="modal-edit-password"
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  className="w-full text-xs px-3 py-2 border rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  บทบาทในระบบ
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(ROLE_LABELS).map(([k, lbl]) => (
                    <label key={k} className="inline-flex items-center gap-2 cursor-pointer text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={userRoles.includes(k)}
                        onChange={(e) => {
                          if (e.target.checked) setUserRoles([...userRoles, k]);
                          else setUserRoles(userRoles.filter((r) => r !== k));
                        }}
                      />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={userIsActive}
                    onChange={(e) => setUserIsActive(e.target.checked)}
                  />
                  เปิดใช้งานบัญชี (Active)
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditUserModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingUser}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  {isSubmittingUser ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </ModalBody>
        </Modal>
      )}

      {/* ลบรหัสบุคลากรตั้งต้น — ลบแล้วเจ้าของรหัสยืนยันตัวตนผ่าน Google ไม่ได้อีก */}
      <ConfirmDialog
        open={pendingDeletePreseed !== null}
        title="ลบรหัสบุคลากรตั้งต้น"
        message={`ลบรหัส ${pendingDeletePreseed?.employee_code ?? ''} (${pendingDeletePreseed?.first_name ?? ''} ${pendingDeletePreseed?.last_name ?? ''}) ออกจากรายชื่อ? เจ้าของรหัสนี้จะยืนยันสิทธิ์ด้วย Google ไม่ได้อีกจนกว่าจะเพิ่มกลับเข้ามาใหม่`}
        confirmLabel="ลบรหัสนี้"
        confirmTestId="preseed-delete-confirm"
        destructive
        busy={deletePreseedBusy}
        onConfirm={handleDeletePreseed}
        onCancel={() => setPendingDeletePreseed(null)}
      />

      {/* กล่องยืนยันการตั้งหัวหน้าสาขาคนใหม่ (SB-G2) */}
      <ConfirmDialog
        open={pendingDeptHeadReplace !== null}
        title="ยืนยันการเปลี่ยนหัวหน้าสาขาวิชา"
        message={pendingDeptHeadReplace?.message || ''}
        confirmLabel="ยืนยันและบันทึก"
        confirmTestId="user-dept-head-replace-confirm"
        busy={isSubmittingUser}
        onConfirm={executeEditUser}
        onCancel={() => setPendingDeptHeadReplace(null)}
      />
    </div>
  );
};

export default UsersAndMasterData;
