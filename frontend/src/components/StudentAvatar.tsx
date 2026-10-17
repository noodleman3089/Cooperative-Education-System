import React, { useState } from 'react';
import { API_BASE_URL } from '../services/api';

interface StudentAvatarProps {
  firstName?: string | null;
  lastName?: string | null;
  /** `students.profile_image` เช่น `avatars/avatar-user-5-….jpg` — เปิดผ่าน `/api/files` ที่ตรวจสิทธิ์เองแล้ว */
  image?: string | null;
  /** px ด้านยาว (สี่เหลี่ยมจัตุรัสกลม) */
  size?: number;
  /** ภาพสี่เหลี่ยมตั้งแบบรูปติดบัตร แทนวงกลม */
  portrait?: boolean;
}

/** รูปนักศึกษา — ไม่มีรูปหรือโหลดไม่ได้ใช้อักษรย่อชื่อ-นามสกุล */
const StudentAvatar: React.FC<StudentAvatarProps> = ({ firstName, lastName, image, size = 44, portrait = false }) => {
  const [failed, setFailed] = useState(false);
  const initials = `${(firstName ?? '').trim().charAt(0)}${(lastName ?? '').trim().charAt(0)}` || '?';
  const style = portrait ? { width: size, height: Math.round(size * 1.25) } : { width: size, height: size };
  const shape = portrait ? 'rounded-lg' : 'rounded-full';

  if (image && !failed) {
    return (
      <img
        src={`${API_BASE_URL}/files/${image}`}
        alt=""
        onError={() => setFailed(true)}
        style={style}
        className={`${shape} shrink-0 border border-gray-200 object-cover dark:border-gray-700`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={style}
      className={`${shape} flex shrink-0 items-center justify-center bg-blue-50 text-sm font-bold text-blue-800 dark:bg-blue-950/50 dark:text-blue-200`}
    >
      {initials}
    </div>
  );
};

export default StudentAvatar;
