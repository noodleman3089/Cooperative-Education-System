import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Users } from 'lucide-react';

const LoginSelection: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 dark:bg-[#111827]">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 md:p-12 shadow-xl border border-gray-100 dark:bg-[#1F2937] dark:border-gray-800 page-enter">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-extrabold tracking-tight text-brand-navy dark:text-white">
            ระบบสหกิจศึกษา RMUTTO
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก | กรุณาเลือกสถานะเพื่อเข้าสู่ระบบ
          </p>
        </div>

        {/*
          Only the two audiences who sign in with their own university account.
          Companies and mentors never register and never come through here —
          they live entirely on /login/company, which their invitation email
          links to. If one loses that email, staff reissue it from the user
          management screen rather than sending them here.
        */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Student */}
          <button
            type="button"
            onClick={() => navigate('/login/student')}
            className="flex flex-col items-center text-center p-6 rounded-2xl border border-gray-200 bg-white hover:border-brand-blue hover:shadow-lg hover:shadow-blue-500/5 transition-all group dark:bg-gray-800 dark:border-gray-700 dark:hover:border-brand-blue"
          >
            <div className="h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center text-brand-blue mb-4 group-hover:scale-110 transition-transform dark:bg-blue-950/30 dark:text-blue-400">
              <GraduationCap className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 dark:text-white group-hover:text-brand-blue transition-colors">
              นักศึกษา
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 line-clamp-3">
              เข้าสู่ระบบด้วยอีเมลมหาวิทยาลัยสำหรับนักศึกษาเพื่อกรอกประวัติและยื่นใบความจำนงสหกิจ
            </p>
          </button>

          {/* Card 2: Personnel */}
          <button
            type="button"
            onClick={() => navigate('/login/personnel')}
            className="flex flex-col items-center text-center p-6 rounded-2xl border border-gray-200 bg-white hover:border-brand-blue hover:shadow-lg hover:shadow-blue-500/5 transition-all group dark:bg-gray-800 dark:border-gray-700 dark:hover:border-brand-blue"
          >
            <div className="h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center text-brand-blue mb-4 group-hover:scale-110 transition-transform dark:bg-blue-950/30 dark:text-blue-400">
              <Users className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 dark:text-white group-hover:text-brand-blue transition-colors">
              อาจารย์และบุคลากร
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 line-clamp-3">
              สำหรับอาจารย์ที่ปรึกษา เจ้าหน้าที่สหกิจ และคณบดี เพื่อดูแลคัดกรอง และอนุมัติการฝึกงาน
            </p>
          </button>

        </div>
      </div>
    </div>
  );
};

export default LoginSelection;
