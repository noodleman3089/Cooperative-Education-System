import { useEffect } from 'react';

/** ต้องตรงกับ `<title>` ใน `frontend/index.html` — ชื่อที่ใช้เมื่อไม่มีหน้าไหนตั้งชื่อของตัวเอง */
const BASE_TITLE = 'ระบบบริหารจัดการสหกิจศึกษา | Cooperative Education Management System';

/**
 * ตั้งชื่อแท็บเบราว์เซอร์ตามหน้าที่เปิดอยู่ — เดิมทุกหน้าใช้ชื่อเดียวกัน เปิดหลายแท็บแล้วแยกไม่ออก
 * และโปรแกรมอ่านหน้าจอไม่ประกาศว่าเปลี่ยนหน้า
 *
 * ผู้เรียกมีสองที่: `Sidebar` (ป้ายเมนูที่เปิดอยู่) และ `LoginCard` (หัวข้อหน้าเข้าสู่ระบบ)
 */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return;
    const full = `${title} · ระบบสหกิจศึกษา`;
    document.title = full;
    return () => {
      // คืนชื่อกลางเฉพาะเมื่อชื่อบนแท็บยังเป็นของเราอยู่ — ตอนเปลี่ยนหน้า หน้าใหม่อาจตั้งชื่อของมันไปก่อนแล้ว
      // (เคยเก็บชื่อเดิมไว้คืน: เข้าสู่ระบบแล้วแท็บหน้าแรกกลับไปใช้ชื่อหน้าเข้าสู่ระบบ)
      if (document.title === full) document.title = BASE_TITLE;
    };
  }, [title]);
}
