import React from 'react';
import { UserPen, Briefcase, Info, X, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Button from './ui/Button';

/**
 * ระบบนำทางเบื้องต้นสำหรับนักศึกษาครั้งแรก
 *
 * เล่าขั้นตอนหลัก 3 ขั้นตอนที่นักศึกษาต้องทำ พร้อมปุ่มนำทาง
 * ไม่ตรวจสถานะจริง — เป็นแค่ guide เพื่อไม่ให้หลงทาง
 *
 * **ใครเห็น:** เฉพาะนักศึกษาที่ยังไม่มีประวัติในฐาน (`needsProfile` ใน StudentDashboard)
 * กรอกประวัติเสร็จแล้ว guide หายเอง — ไม่มีการเก็บ flag ที่ไหนทั้งสิ้น
 *
 * หมายเหตุการแก้รอบตรวจ:
 * - ปุ่มใช้ `ui/Button` และไอคอนใช้ lucide เหมือนทั้งระบบ (เคยเขียน SVG มือ 8 อัน
 *   ทั้งที่ StudentDashboard ที่เรียกมัน import lucide อยู่แล้ว)
 * - แถวขั้นตอนเป็น `flex-wrap` เพราะบนจอ 375px ปุ่ม `shrink-0` กว้าง 160px
 *   บีบข้อความเหลือ 3px จนตัวอักษรไทยเรียงลงมาทีละตัว แถวสูง 688px
 */

type AccentColor = 'blue' | 'rose' | 'amber';

interface Step {
  number: number;
  title: string;
  description: string;
  menuId: string;
  actionLabel: string;
  icon: LucideIcon;
  accentColor: AccentColor;
}

const STEPS: Step[] = [
  {
    number: 1,
    title: 'กรอกประวัตินักศึกษาให้ครบถ้วน',
    description:
      'เพิ่มข้อมูลส่วนตัว ที่อยู่ เบอร์โทรศัพท์ และอัปโหลดเรซูเม่ เพื่อให้ระบบออกเอกสารและจับคู่ตำแหน่งงานได้',
    menuId: 'profile',
    actionLabel: 'ไปหน้าข้อมูลส่วนตัว',
    icon: UserPen,
    accentColor: 'blue',
  },
  {
    number: 2,
    title: 'เลือกสถานประกอบการและยื่นแบบแจ้งความจำนง',
    description:
      'ค้นหาตำแหน่งงานที่เปิดรับ หรือยื่นสถานที่ฝึกงานที่หาเอง เพื่อออกหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1)',
    menuId: 'jobs',
    actionLabel: 'ดูตำแหน่งงานและยื่นคำร้อง',
    icon: Briefcase,
    accentColor: 'amber',
  },
];

const ACCENT_MAP: Record<AccentColor, { bg: string; text: string; ring: string }> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-brand-blue dark:text-blue-400',
    ring: 'ring-blue-100',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-600 dark:text-rose-400',
    ring: 'ring-rose-100',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-100',
  },
};

interface StudentWelcomeGuideProps {
  onDismiss: () => void;
}

const StudentWelcomeGuide: React.FC<StudentWelcomeGuideProps> = ({ onDismiss }) => {
  const navigateTo = (menuId: string) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: menuId }));
  };

  return (
    <div className="page-enter rounded-2xl border border-blue-200/80 bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/40 p-6 sm:p-8 shadow-sm dark:border-blue-900/40 dark:from-gray-900 dark:via-blue-950/10 dark:to-indigo-950/10">
      {/* Header */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-bold text-brand-blue dark:bg-blue-950/60 dark:text-blue-400">
            <Info className="h-3.5 w-3.5" />
            แนะนำขั้นตอนเริ่มต้น
          </span>
        </div>
        <h3 className="text-lg font-extrabold tracking-tight text-gray-800 dark:text-white">
          ยินดีต้อนรับสู่ระบบสหกิจศึกษา!
        </h3>
        {/* gray-600 ไม่ใช่ 500 — ตัวนี้นั่งบน gradient ของการ์ด ไม่ใช่พื้นขาว (gray-500 ที่นั่น = 4.39 ตกเกณฑ์) */}
        <p className="max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          นี่คือขั้นตอนหลักที่ต้องดำเนินการตามลำดับ กดปุ่มในแต่ละขั้นตอนเพื่อไปยังหน้าที่ต้องการได้เลย
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map((step) => {
          const accent = ACCENT_MAP[step.accentColor];
          const StepIcon = step.icon;
          return (
            <div
              key={step.number}
              className="group flex flex-wrap items-start gap-4 rounded-xl border border-gray-200/80 bg-white p-4 sm:flex-nowrap sm:p-5 transition-all hover:border-brand-blue/30 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-900/50"
            >
              {/* Step icon */}
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent.bg} ring-2 ${accent.ring} dark:ring-transparent transition-transform group-hover:scale-110`}
              >
                <StepIcon className={`h-5 w-5 ${accent.text}`} />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {step.number}
                  </span>
                  <h4 className="text-sm font-bold text-gray-800 dark:text-white">{step.title}</h4>
                </div>
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{step.description}</p>
              </div>

              {/* Action button — เต็มความกว้างบนมือถือ (ตกลงมาบรรทัดล่างด้วย flex-wrap) */}
              <div className="w-full sm:w-auto sm:shrink-0 sm:self-center">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => navigateTo(step.menuId)}
                >
                  {step.actionLabel}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dismiss — ปิดแค่รอบนี้ ไม่ได้จำข้ามการรีเฟรช ป้ายจึงต้องไม่สัญญาว่า "ไม่แสดงอีก" */}
      <div className="mt-5 flex items-center justify-end">
        <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onDismiss}>
          ซ่อนคำแนะนำนี้
        </Button>
      </div>
    </div>
  );
};

export default StudentWelcomeGuide;
