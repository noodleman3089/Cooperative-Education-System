import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { getErrorMessage, getErrorName } from '../utils/errors';

/**
 * สถานะของ "ข้อมูลหนึ่งชุดที่มาจาก endpoint หนึ่งตัว"
 *
 * ⛔ ตัวนี้ **ไม่ได้มาแทน `useDashboardData`** — มันนั่งอยู่ใต้ตัวนั้น
 *   `useDashboardData` ตอบคำถามว่า *"เมื่อไหร่ควรโหลดซ้ำ"* (ทุก 10 วิ · ตอนกลับมาที่แท็บ ·
 *   ตอนมี event `intent-updated`) และมันทำถูกอยู่แล้ว
 *   `useResource` ตอบคำถามที่เหลือคือ *"ระหว่างโหลดหน้าจอควรเป็นยังไง"* — ซึ่งตอนนี้
 *   ทุกหน้าเขียน `useState` สามตัว (data / loading / error) ซ้ำกันเองทั้งแอป
 *   แก้บั๊กที่หนึ่งจึงเป็นการแก้ที่เดียวเสมอ
 *
 * ใช้คู่กันได้ตรงๆ:
 *   const companies = useResource<Company[]>('/companies', { initial: [] });
 *   useDashboardData(companies.reload, []);
 */
export interface Resource<T> {
  /** ข้อมูลล่าสุดที่โหลดสำเร็จ — ยังเป็นของรอบก่อนอยู่ระหว่างโหลดเบื้องหลัง */
  data: T;
  /** โหลดครั้งแรกอยู่ · ใช้ตัวนี้ตัดสินใจว่าจะโชว์ skeleton ไหม */
  loading: boolean;
  /** โหลดซ้ำเบื้องหลังอยู่ — จอยังมีข้อมูลเดิมให้ดู ห้ามพลิกกลับเป็น skeleton */
  refreshing: boolean;
  /** ข้อความภาษาไทยพร้อมแสดง หรือ null */
  error: string | null;
  /**
   * โหลดใหม่ · ส่ง `true` เมื่อเป็นการโหลดเบื้องหลัง (จอไม่กระพริบ และแถบข้อความ
   * ที่ผู้ใช้เพิ่งทำให้เกิดจะไม่ถูกล้าง) — ลายเซ็นตรงกับที่ `useDashboardData` เรียก
   */
  reload: (isBackground?: boolean) => Promise<void>;
  /** เขียนทับข้อมูลในมือโดยไม่ยิง API — สำหรับอัปเดตแถวเดียวหลังกดปุ่มสำเร็จ */
  setData: React.Dispatch<React.SetStateAction<T>>;
}

interface Options<T> {
  /** ค่าเริ่มต้นก่อนข้อมูลจริงมาถึง — ใส่ `[]` ไว้เสมอสำหรับ endpoint ที่คืนรายการ */
  initial: T;
  /** หยิบส่วนที่ต้องการออกจาก response — endpoint ในระบบนี้ห่อข้อมูลไม่เหมือนกัน */
  select?: (raw: unknown) => T;
  /** ยังไม่ต้องโหลด (เช่นรอ id จาก dropdown) — `false` แล้วค่อยเป็น `true` จะโหลดให้เอง */
  enabled?: boolean;
  /** ข้อความสำรองเมื่อเซิร์ฟเวอร์ไม่ได้บอกเหตุผล */
  errorFallback?: string;
}

/**
 * โหลดข้อมูลจาก endpoint หนึ่งตัว แล้วคืนสถานะครบชุดให้หน้าจอใช้
 *
 * เหตุผลที่ต้องมีตัวกันคำตอบข้ามรอบ (`seqRef`): หน้าที่มีฟิลเตอร์จะยิงคำขอใหม่ทุกครั้ง
 * ที่ผู้ใช้พิมพ์ คำขอที่ยิงก่อนอาจกลับมาทีหลัง ถ้าเขียนลง state ตรงๆ ผู้ใช้จะเห็น
 * ผลของคำค้นเก่าทับคำค้นใหม่ — เป็นบั๊กที่หาไม่เจอเพราะมันเกิดเฉพาะตอนเน็ตช้า
 */
export function useResource<T>(path: string | null, options: Options<T>): Resource<T> {
  const { initial, select, enabled = true, errorFallback } = options;

  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState<boolean>(enabled && path !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** ผลลัพธ์ของคำขอที่ไม่ใช่รอบล่าสุดจะถูกทิ้ง */
  const seqRef = useRef(0);
  /** เลิกเขียน state หลังหน้าจอถูกถอดออกไปแล้ว */
  const aliveRef = useRef(true);
  /** เคยโหลดสำเร็จอย่างน้อยหนึ่งครั้งหรือยัง — ใช้ตัดสินว่าจะโชว์ skeleton อีกไหม */
  const loadedOnceRef = useRef(false);

  // เก็บไว้ใน ref เพราะผู้เรียกเขียน `select` เป็น arrow function ใหม่ทุก render
  // ถ้าใส่ลง dependency ของ useCallback ตรงๆ `reload` จะเปลี่ยนตัวทุก render
  // แล้ว useDashboardData ที่ถือมันอยู่จะรื้อ interval ทิ้งทุกครั้ง
  const selectRef = useRef(select);
  const fallbackRef = useRef(errorFallback);

  // ⛔ ต้องเขียน ref ใน effect ไม่ใช่กลาง render (กฎของ eslint-plugin-react-hooks)
  //    · effect นี้ประกาศไว้ก่อน effect ที่สั่งโหลด จึงทำงานก่อนเสมอในคอมมิตเดียวกัน
  //    · และรอบแรก `useRef(...)` ก็ตั้งค่าถูกอยู่แล้วตั้งแต่ต้น
  useEffect(() => {
    selectRef.current = select;
    fallbackRef.current = errorFallback;
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(
    async (isBackground = false) => {
      if (path === null) return;

      const seq = ++seqRef.current;

      // การโหลดเบื้องหลังห้ามพลิกจอกลับเป็น skeleton และห้ามล้างแถบ error ทิ้ง
      // ก่อนที่จะรู้ว่ารอบใหม่สำเร็จ — ไม่งั้นข้อความที่ผู้ใช้เพิ่งทำให้เกิดจะหายเอง
      // ภายใน 10 วินาที ซึ่งเป็นอาการที่กฎในโซน frontend เตือนไว้แล้ว
      if (isBackground || loadedOnceRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const raw = await api.get(path);
        if (!aliveRef.current || seq !== seqRef.current) return;

        const next = selectRef.current ? selectRef.current(raw) : (raw as T);
        setData(next);
        setError(null);
        loadedOnceRef.current = true;
      } catch (err) {
        if (!aliveRef.current || seq !== seqRef.current) return;

        // 401 ถูกจัดการที่ services/api.ts แล้ว — มันล้าง auth_user และยิง event
        // ให้แอปพากลับไปหน้าเข้าสู่ระบบ การขึ้นแถบแดงซ้อนตอนกำลังเด้งออกคือเสียงรบกวน
        if (err instanceof Error && err.message === 'Unauthorized') return;
        if (getErrorName(err) === 'AbortError') return;

        setError(getErrorMessage(err, fallbackRef.current));
      } finally {
        if (aliveRef.current && seq === seqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path]
  );

  const active = enabled && path !== null;

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  return {
    data,
    // ตอนที่ยังไม่ถึงคิวโหลด (รอ id จาก dropdown อยู่) ต้องไม่นับเป็นกำลังโหลด
    // — คำนวณตอนคืนค่า แทนการ setState ใน effect ซึ่งทำให้ render สองรอบเปล่าๆ
    loading: active ? loading : false,
    refreshing,
    error,
    reload,
    setData,
  };
}

export default useResource;
