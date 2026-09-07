/**
 * ปฏิทินสหกิจ → เมนูของนักศึกษา
 *
 * ที่นี่ที่เดียวที่บอกว่า "กิจกรรมในปฏิทินอันนี้ ไปทำที่เมนูไหน" ใช้ร่วมกันสองที่:
 *   · `Dashboard.tsx`      — แขวนกุญแจบนเมนูเมื่อพ้นช่วง
 *   · `CoopTimeline.tsx`   — กดแถบในปฏิทินแล้วพาไปทำเลย
 *
 * ⛔ **`menu` กับ `locksMenu` ไม่ใช่เรื่องเดียวกัน อย่ายุบรวม**
 *
 * `menu` = "ไปทำสิ่งนี้ที่ไหน" · `locksMenu` = "ปฏิทินมีสิทธิ์ล็อกเมนูนั้นทั้งเมนูไหม"
 *
 * เมนูที่ทำหลายอย่างจะเป็น `locksMenu: false` เพราะการล็อกทั้งเมนูเพราะกิจกรรม
 * เดียวหมดเวลาคือการปิดของที่ไม่เกี่ยวไปด้วย — เช่น `jobs` ยังต้องเปิดให้ดู
 * ตำแหน่งงานได้แม้ช่วงยื่นความจำนงจะปิดไปแล้ว และ `dashboard` คือหน้าแรก
 * ซึ่งล็อกไม่ได้อยู่แล้ว · ตัวที่ปฏิเสธคำขอจริงคือเซิร์ฟเวอร์ (`calendarGate.ts`)
 * ไม่ใช่กุญแจบนเมนู กุญแจเป็นแค่การบอกล่วงหน้าเพื่อไม่ให้เสียเวลากรอก
 */
export interface CalendarMenuTarget {
  /** เมนูที่พาไปเมื่อกดแถบในปฏิทิน */
  menu: string;
  /** ปฏิทินแขวนกุญแจบนเมนูนี้ได้ไหมเมื่อพ้นช่วง */
  locksMenu: boolean;
}

export const CALENDAR_MENU_BY_ACTIVITY: Record<string, CalendarMenuTarget> = {
  coop_application: { menu: 'application', locksMenu: true },
  // การยื่นความจำนงเริ่มจากเลือกตำแหน่งงาน — แต่หน้ารายการงานยังต้องเปิดให้ดูเสมอ
  intent_submission: { menu: 'jobs', locksMenu: false },
  // แบบตอบรับ (เอกสารหมายเลข 2) อัปโหลดที่กล่องสถานะบนหน้าแรก ไม่มีเมนูของตัวเอง
  acceptance_form: { menu: 'dashboard', locksMenu: false },
  accommodation_plan: { menu: 'accommodation_plan', locksMenu: true },
  weekly_log: { menu: 'weekly_log', locksMenu: true },
  report_outline: { menu: 'report_outline', locksMenu: true },
  final_report: { menu: 'final_report', locksMenu: true },
  // ⛔ `coop_start` · `coop_end` · `coop_exam` จงใจไม่มีในตารางนี้ — เป็นหมุดบอกเวลา
  //    ไม่มีอะไรให้นักศึกษาไปทำ การใส่เมนูให้มันคือการหลอกว่ากดแล้วมีอะไรเกิดขึ้น
};

/** เมนูที่พาไปเมื่อกดแถบในปฏิทิน · null = กิจกรรมนี้ไม่มีอะไรให้ไปทำ */
export function actionMenuFor(activityKey: string): string | null {
  return CALENDAR_MENU_BY_ACTIVITY[activityKey]?.menu ?? null;
}

/** พาไปเมนูนั้น — ใช้ช่องทางเดียวกับปุ่มอื่นๆ ทั้งแอป (`Dashboard.tsx` ดักไว้) */
export function goToMenu(menu: string): void {
  window.dispatchEvent(new CustomEvent('navigate', { detail: menu }));
}
