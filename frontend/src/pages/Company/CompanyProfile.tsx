import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';

/**
 * ข้อมูลสถานประกอบการ — เดิมเป็นแท็บ 'profile' ปนอยู่ใน `CompanyDashboard.tsx`
 * (spec-D 14.1: ย้ายออกมาเป็นหน้าจอของตัวเอง ในโครงเดียวกับ `MentorProfile.tsx`)
 *
 * ทะเบียนบริษัท (ชื่อ/ที่ตั้ง/สถานะตรวจสอบ) เป็นข้อมูลที่ผ่านการตรวจของเจ้าหน้าที่
 * และใช้พิมพ์ลงหนังสือราชการ — แก้ไม่ได้จากหน้านี้ ผู้ติดต่อประสานงานเท่านั้นที่แก้เองได้
 */

interface CompanyProfile {
  company_id: number;
  name_th: string;
  name_en: string | null;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
  is_verified: boolean;
  contact_person: string | null;
  contact_position: string | null;
  email: string | null;
}

const CompanyProfile: React.FC = () => {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [contactPerson, setContactPerson] = useState('');
  const [contactPosition, setContactPosition] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const res: CompanyProfile | null = await api.get('/companies/my-company');
      setProfile(res);
      if (res) {
        setContactPerson(res.contact_person || '');
        setContactPosition(res.contact_position || '');
        setContactEmail(res.email || '');
      }
    } catch (err) {
      console.error('Failed to load company profile:', err);
      setError(getErrorMessage(err, 'ไม่สามารถเรียกข้อมูลสถานประกอบการได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (!contactPerson || !contactPosition || !contactEmail) {
      setError('กรุณากรอกรายละเอียดผู้ประสานงานหลักให้ครบถ้วน');
      return;
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(null);
    try {
      await api.put('/companies/my-company/contact-info', {
        contact_person: contactPerson,
        contact_position: contactPosition,
        email: contactEmail,
      });
      setSuccess('บันทึกปรับปรุงข้อมูลการติดต่อประสานงานบริษัทสำเร็จเรียบร้อย');
      await loadProfile();
    } catch (err) {
      console.error('Update company profile error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถแก้ไขข้อมูลผู้ติดต่อได้'));
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant="form" />;
  }

  return (
    <div className="max-w-xl space-y-6 page-enter">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* ข้อมูลที่ผ่านการตรวจแล้ว ใช้พิมพ์ลงหนังสือราชการ — แก้ได้ที่เจ้าหน้าที่เท่านั้น */}
      {profile && (
        <div className="bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ข้อมูลสถานประกอบการในทะเบียนของมหาวิทยาลัย</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
            หากข้อมูลส่วนนี้ไม่ถูกต้อง กรุณาแจ้งเจ้าหน้าที่งานสหกิจศึกษาเพื่อแก้ไข
            เนื่องจากเป็นข้อมูลที่ผ่านการตรวจสอบและใช้พิมพ์ลงหนังสือราชการ
          </p>

          <dl className="space-y-3 text-xs">
            {[
              ['ชื่อสถานประกอบการ (ไทย)', profile.name_th],
              ['ชื่อสถานประกอบการ (อังกฤษ)', profile.name_en || '-'],
              ['ที่ตั้ง', `${profile.address} ${profile.district} ${profile.province} ${profile.postal_code}`],
              ['โทรศัพท์', profile.phone || '-'],
              ['สถานะการตรวจสอบ', profile.is_verified ? 'ผ่านการยืนยันข้อมูลแล้ว' : 'รอเจ้าหน้าที่ตรวจสอบข้อมูล'],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="sm:w-48 shrink-0 font-medium text-gray-500 dark:text-gray-400">{label}</dt>
                <dd className="text-gray-800 dark:text-gray-200">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ตั้งค่าผู้ติดต่อประสานงานหลัก</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
          ข้อมูลตรงนี้เจ้าหน้าที่จำเป็นต้องใช้ในการนำฟิลด์ไปกรอกจดหมายราชการส่งตัวคณบดี
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ชื่อ-นามสกุล ผู้ประสานงานหลักฝ่าย HR
            </label>
            <Input type="text" required value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">ตำแหน่งงาน</label>
            <Input type="text" required value={contactPosition} onChange={(e) => setContactPosition(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              อีเมลผู้ติดต่อประสานงาน (รับเอกสารตอบรับส่งตัว)
            </label>
            <Input type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </div>

          <Button type="submit" loading={isUpdating} loadingLabel="กำลังบันทึก...">
            บันทึกข้อมูลติดต่อหลัก
          </Button>
        </form>
      </div>
    </div>
  );
};

export default CompanyProfile;
