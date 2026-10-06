import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';

/**
 * The mentor's own profile.
 *
 * Mentors used to be sent to `PersonnelProfile`, the screen for university
 * staff. It greeted them with "การตั้งค่าโปรไฟล์บุคลากร", asked them to pick a
 * university major, offered to set the digital signature used to stamp official
 * documents, reported "สถานะ: รอการอนุมัติบัญชี" which was never true, and
 * showed a permanent red banner because a mentor has no row in `personnel`.
 * Meanwhile the four details the company registered on their behalf — name,
 * position, department, phone — could not be seen or corrected anywhere in the
 * system, by anybody.
 *
 * Company and login email are shown but not editable: the placement decides
 * which company a mentor belongs to, and the address is what the invitation was
 * sent to.
 */

interface MentorProfileData {
  mentor_id: number;
  company_id: number;
  name: string;
  position: string | null;
  department: string | null;
  phone: string;
  company_name_th: string;
  email: string;
}

const MentorProfile: React.FC = () => {
  const [profile, setProfile] = useState<MentorProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await api.get('/profile/me');
      const prof: MentorProfileData | undefined = res.profile;
      if (prof) {
        setProfile(prof);
        setName(prof.name || '');
        setPosition(prof.position || '');
        setDepartment(prof.department || '');
        setPhone(prof.phone || '');
      }
    } catch (err) {
      console.error('Failed to load mentor profile:', err);
      setError(
        getErrorStatus(err) === 404
          ? 'ยังไม่พบข้อมูลพี่เลี้ยงของบัญชีนี้ในระบบ กรุณาติดต่อผู้ประสานงานของสถานประกอบการ'
          : 'ไม่สามารถเรียกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim() || !phone.trim()) {
      setError('กรุณากรอกชื่อ-นามสกุล และเบอร์โทรศัพท์ติดต่อ');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.put('/profile/mentor', {
        name: name.trim(),
        position: position.trim(),
        department: department.trim(),
        phone: phone.trim(),
      });
      setSuccess('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
      if (res.profile && profile) {
        setProfile({ ...profile, ...res.profile });
      }
    } catch (err) {
      console.error('Failed to update mentor profile:', err);
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant="form" />;
  }

  const inputClass =
    'w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white';
  const readOnlyClass =
    'w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 font-medium';

  return (
    <div className="max-w-2xl bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 page-enter">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">ข้อมูลส่วนตัวพนักงานที่ปรึกษา</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          ข้อมูลชุดนี้ถูกกรอกไว้โดยผู้ประสานงานของสถานประกอบการตอนตอบรับนักศึกษา
          หากไม่ถูกต้องสามารถแก้ไขได้ที่หน้านี้ — อาจารย์ที่ปรึกษาจะใช้ข้อมูลนี้ติดต่อท่านเพื่อนัดหมายนิเทศ
        </p>
      </div>

      <AlertBanner variant="error" message={error} className="mb-4" />
      <AlertBanner variant="success" message={success} className="mb-4" />

      {profile && (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Read-only: neither of these is the mentor's to change. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                สถานประกอบการที่สังกัด
              </label>
              <div className={readOnlyClass}>
                {profile.company_name_th}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                อีเมลสำหรับเข้าสู่ระบบ
              </label>
              <div className={readOnlyClass}>{profile.email}</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ชื่อ-นามสกุล *
            </label>
            <input
              type="text"
              value={name}
              disabled={isSubmitting}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ตำแหน่งงาน
              </label>
              <input
                type="text"
                value={position}
                disabled={isSubmitting}
                onChange={(e) => setPosition(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                แผนก/ฝ่ายสังกัด
              </label>
              <input
                type="text"
                value={department}
                disabled={isSubmitting}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              เบอร์โทรศัพท์ติดต่อ *
            </label>
            <input
              type="tel"
              value={phone}
              disabled={isSubmitting}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-end">
            <Button type="submit" loading={isSubmitting} loadingLabel="กำลังบันทึกข้อมูล...">
              บันทึกข้อมูลส่วนตัว
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default MentorProfile;
