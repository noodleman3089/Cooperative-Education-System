import React, { useCallback, useState } from 'react';
import { UserCheck } from 'lucide-react';
import api from '../../services/api';
import { useDashboardData } from '../../hooks/useDashboardData';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import type { IntentForm } from '../../types/api';

/**
 * หน้าจอ "พี่เลี้ยงของฉัน" (เมนู my_mentor ของนักศึกษา)
 *
 * สามสภาพ (`mentor-card` data-state):
 * 1. none = ยังไม่ได้ระบุ → แสดงฟอร์มให้กรอก
 * 2. unconfirmed = ระบุแล้ว รอยืนยัน → แสดงชื่อ + ข้อความรออาจารย์นิเทศยืนยัน + ปุ่มแก้ไข
 * 3. confirmed = ยืนยันแล้ว → แสดงชื่ออย่างเดียว แก้เองไม่ได้
 */

const mentorFieldKeys = ['name', 'email', 'phone', 'position', 'department'] as const;
type MentorFieldKey = (typeof mentorFieldKeys)[number];

const mentorFieldLabels: Record<MentorFieldKey, string> = {
  name: 'ชื่อ-นามสกุล พี่เลี้ยง *',
  email: 'อีเมล พี่เลี้ยง *',
  phone: 'เบอร์โทรศัพท์ พี่เลี้ยง *',
  position: 'ตำแหน่ง (ไม่บังคับ)',
  department: 'ฝ่าย / แผนก (ไม่บังคับ)',
};

const MyMentor: React.FC = () => {
  const [activeIntent, setActiveIntent] = useState<IntentForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mentorSet, setMentorSet] = useState({
    name: '',
    email: '',
    phone: '',
    position: '',
    department: '',
  });
  const [mentorSetOpen, setMentorSetOpen] = useState(false);
  const [mentorSetBusy, setMentorSetBusy] = useState(false);
  const [mentorSetError, setMentorSetError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await api.get('/students/dashboard');
      const intent: IntentForm | null = res?.activeIntent ?? null;
      setActiveIntent(intent);
      if (intent?.mentor) {
        setMentorSet({
          name: intent.mentor.name || '',
          email: intent.mentor.email || '',
          phone: intent.mentor.phone || '',
          position: intent.mentor.position || '',
          department: intent.mentor.department || '',
        });
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลพี่เลี้ยงได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useDashboardData(loadData, [loadData]);

  const intentMentor = activeIntent?.mentor;
  const mentorCardState: 'none' | 'unconfirmed' | 'confirmed' | null =
    activeIntent?.status !== 'accepted'
      ? null
      : !intentMentor?.name
        ? 'none'
        : intentMentor.confirmed
          ? 'confirmed'
          : 'unconfirmed';

  const openMentorForm = () => {
    setMentorSet({
      name: intentMentor?.name ?? '',
      email: intentMentor?.email ?? '',
      phone: intentMentor?.phone ?? '',
      position: intentMentor?.position ?? '',
      department: intentMentor?.department ?? '',
    });
    setMentorSetError(null);
    setMentorSetOpen(true);
  };

  const submitMentorSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIntent) return;
    setMentorSetBusy(true);
    setMentorSetError(null);
    try {
      await api.post(`/intents/${activeIntent.form_id}/mentor`, {
        name: mentorSet.name.trim(),
        email: mentorSet.email.trim(),
        phone: mentorSet.phone.trim(),
        position: mentorSet.position.trim(),
        department: mentorSet.department.trim(),
      });
      setMentorSetOpen(false);
      await loadData();
    } catch (err) {
      setMentorSetError(getErrorMessage(err, 'บันทึกข้อมูลพี่เลี้ยงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setMentorSetBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 page-enter max-w-4xl mx-auto">
        <PageSkeleton variant="form" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6 page-enter max-w-4xl mx-auto">
        <AlertBanner variant="error" message={loadError} />
      </div>
    );
  }

  const isFormVisible = mentorCardState === 'none' || (mentorCardState === 'unconfirmed' && mentorSetOpen);

  return (
    <div className="space-y-6 page-enter max-w-4xl mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <UserCheck className="h-6 w-6 text-brand-blue dark:text-blue-400" />
          พี่เลี้ยงของฉัน
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          ข้อมูลพนักงานที่ปรึกษา (พี่เลี้ยง) ประจำสถานประกอบการ
        </p>
      </div>

      <div
        data-testid="mentor-card"
        data-state={mentorCardState ?? 'none'}
        className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-4"
      >
        {mentorCardState === 'none' && (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">ยังไม่ได้ระบุพี่เลี้ยง</p>
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              เมื่อเริ่มปฏิบัติงานและทราบชื่อพนักงานที่ปรึกษา (พี่เลี้ยง) แล้ว ให้กรอกข้อมูลด้านล่างนี้ —
              อาจารย์นิเทศจะเป็นผู้ยืนยันก่อนระบบส่งลิงก์เข้าใช้งานให้พี่เลี้ยง
            </p>
          </div>
        )}

        {mentorCardState === 'unconfirmed' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base font-bold text-gray-900 dark:text-white">
                {intentMentor?.name}
              </span>
              {!mentorSetOpen && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="mentor-edit"
                  onClick={openMentorForm}
                >
                  แก้ข้อมูลพี่เลี้ยง
                </Button>
              )}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
              {intentMentor?.email && <p>อีเมล: {intentMentor.email}</p>}
              {intentMentor?.phone && <p>เบอร์โทรศัพท์: {intentMentor.phone}</p>}
              {intentMentor?.position && <p>ตำแหน่ง: {intentMentor.position}</p>}
              {intentMentor?.department && <p>ฝ่าย / แผนก: {intentMentor.department}</p>}
            </div>
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 pt-1">
              {activeIntent?.supervisor_assigned === false ? (
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  รอหัวหน้าสาขาจัดสรรอาจารย์นิเทศ แล้วอาจารย์นิเทศจะเป็นผู้ยืนยันพี่เลี้ยง
                </span>
              ) : (
                <>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">รออาจารย์นิเทศยืนยันพี่เลี้ยง</span> —{' '}
                  พี่เลี้ยงจะได้รับลิงก์เข้าใช้งานหลังอาจารย์นิเทศยืนยัน · ข้อมูลผิดแก้ได้จนกว่าจะถูกยืนยัน
                </>
              )}
            </p>
          </div>
        )}

        {mentorCardState === 'confirmed' && (
          <div className="space-y-2">
            <span className="text-base font-bold text-gray-900 dark:text-white">
              {intentMentor?.name}
            </span>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
              {intentMentor?.email && <p>อีเมล: {intentMentor.email}</p>}
              {intentMentor?.phone && <p>เบอร์โทรศัพท์: {intentMentor.phone}</p>}
              {intentMentor?.position && <p>ตำแหน่ง: {intentMentor.position}</p>}
              {intentMentor?.department && <p>ฝ่าย / แผนก: {intentMentor.department}</p>}
            </div>
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 pt-1">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">อาจารย์นิเทศยืนยันพี่เลี้ยงแล้ว</span> —{' '}
              หากข้อมูลไม่ถูกต้อง กรุณาแจ้งอาจารย์นิเทศหรือเจ้าหน้าที่สหกิจศึกษา
            </p>
          </div>
        )}

        {isFormVisible && (
          <form
            data-testid="mentor-form"
            onSubmit={submitMentorSet}
            className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mentorFieldKeys.map((key) => (
                <div key={key}>
                  <label htmlFor={`mentor-set-${key}`} className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
                    {mentorFieldLabels[key]}
                  </label>
                  <Input
                    id={`mentor-set-${key}`}
                    data-testid={`mentor-${key}`}
                    type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                    required={key === 'name' || key === 'email' || key === 'phone'}
                    disabled={mentorSetBusy}
                    value={mentorSet[key]}
                    onChange={(e) => setMentorSet((prev) => ({ ...prev, [key]: e.target.value }))}
                    size="sm"
                  />
                </div>
              ))}
            </div>
            <AlertBanner variant="error" message={mentorSetError} />
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" data-testid="mentor-submit" disabled={mentorSetBusy}>
                {mentorSetBusy ? 'กำลังบันทึก...' : 'บันทึกข้อมูลพี่เลี้ยง'}
              </Button>
              {mentorCardState === 'unconfirmed' && (
                <Button variant="secondary" size="sm" disabled={mentorSetBusy} onClick={() => setMentorSetOpen(false)}>
                  ยกเลิก
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default MyMentor;
