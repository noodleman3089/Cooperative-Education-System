import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Users } from 'lucide-react';

/**
 * ประตูแรกของระบบ
 *
 * คำเดิมบนหน้านี้คือ "กรุณาเลือกสถานะเพื่อเข้าสู่ระบบ" ซึ่งเป็นภาษาของฐานข้อมูล —
 * `role` ในตาราง `user_roles` ไม่ใช่คำที่คนถามตัวเองตอนยืนอยู่หน้าจอ คนถามว่า
 * *"ฉันเป็นใครในเรื่องนี้"* หัวข้อกับป้ายบนการ์ดจึงเขียนเป็นประโยคของผู้ใช้เอง
 * ("ฉันเป็นนักศึกษา") และบอกต่อว่ากดเข้าไปแล้วทำอะไรได้ ไม่ใช่แค่ชื่อกลุ่ม
 *
 * ⛔ **บริษัทกับพี่เลี้ยงไม่มีทางเข้าที่หน้านี้** — เข้าจากลิงก์เชิญใช้ครั้งเดียว
 * ทางอีเมลเท่านั้น (SEC-09) ลิงก์นั้นพาไปที่ `/login/company` ตรงๆ
 * เคยมีย่อหน้าอธิบายเรื่องนี้อยู่ท้ายหน้า เจ้าของให้ตัดออกเมื่อ 2026-09-07
 * เพราะคนที่ยืนอยู่หน้านี้ไม่ใช่คนที่ต้องรู้ — คนที่ต้องรู้คือเจ้าหน้าที่ที่ออกลิงก์
 */
const LoginSelection: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 py-12 dark:bg-[#111827]">
      <div className="page-enter flex w-full max-w-3xl flex-col gap-7">

        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="h-6 w-6 text-brand-navy dark:text-blue-400" />
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">
              มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-navy dark:text-white">
            ระบบสหกิจศึกษา
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            เลือกว่าคุณกำลังเข้าใช้งานในฐานะอะไร
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-[#1F2937]">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

            <button
              type="button"
              onClick={() => navigate('/login/student')}
              data-testid="login-as-student"
              className="group flex flex-col gap-3.5 rounded-2xl border border-gray-200 bg-white p-5 text-left transition-all hover:border-brand-blue hover:shadow-lg hover:shadow-blue-500/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-blue"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-brand-blue transition-transform group-hover:scale-110 dark:bg-blue-950/30 dark:text-blue-400">
                  <GraduationCap className="h-6 w-6" />
                </div>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  ฉันเป็นนักศึกษา
                </span>
              </div>
              <p className="grow text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                ยื่นเรื่องขอออกสหกิจ ส่งเอกสารตามขั้นตอน และดูว่าเรื่องของตัวเองไปถึงไหนแล้ว
              </p>
              <span className="inline-flex w-full items-center justify-center rounded-xl bg-brand-blue px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors group-hover:bg-brand-navy">
                เข้าสู่ระบบด้วยอีเมลมหาวิทยาลัย
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/login/personnel')}
              data-testid="login-as-personnel"
              className="group flex flex-col gap-3.5 rounded-2xl border border-gray-200 bg-white p-5 text-left transition-all hover:border-brand-blue hover:shadow-lg hover:shadow-blue-500/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-blue"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-brand-blue transition-transform group-hover:scale-110 dark:bg-blue-950/30 dark:text-blue-400">
                  <Users className="h-6 w-6" />
                </div>
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  ฉันเป็นอาจารย์หรือเจ้าหน้าที่
                </span>
              </div>
              <p className="grow text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                ตรวจคำร้อง ออกหนังสือราชการ ออกนิเทศ และประเมินผลนักศึกษา
              </p>
              <span className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors group-hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:group-hover:bg-gray-800">
                เข้าสู่ระบบด้วยอีเมลบุคลากร
              </span>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginSelection;
