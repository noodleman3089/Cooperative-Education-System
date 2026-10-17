import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Hook สำหรับตรวจจับพารามิเตอร์ `?highlight=<elementId>` จาก URL
 * เมื่อพบ จะเลื่อนหน้าจอไปยังจุดนั้น และเพิ่มคลาสกระพริบแสงอ่อนๆ (.highlight-pulse)
 */
export function usePulseHighlight() {
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  useEffect(() => {
    if (!highlightId) return;

    // หน่วงเวลาเล็กน้อยเพื่อให้ DOM render เสร็จสมบูรณ์ (ตัวเลข 200ms นี้ตั้งเอง ยังไม่มีที่มา)
    const timer = setTimeout(() => {
      // ค้นหาทั้งจาก id ปกติ และจาก data-testid
      const el =
        document.getElementById(highlightId) ||
        document.querySelector(`[data-testid="${highlightId}"]`) ||
        document.querySelector(`[data-highlight-id="${highlightId}"]`);

      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-pulse');

        // เอาคลาสออกหลังจากแอนิเมชันกระพริบจบ (3.6 วินาที: ตัวเลขนี้ตั้งเอง ยังไม่มีที่มา)
        setTimeout(() => {
          el.classList.remove('highlight-pulse');
        }, 3600);
      }

      // ลบพารามิเตอร์ highlight ออกจาก URL เพื่อป้องกันการกระพริบซ้ำเมื่อผู้ใช้รีเฟรชหน้า
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('highlight');
          return next;
        },
        { replace: true }
      );
    }, 200);

    return () => clearTimeout(timer);
  }, [highlightId, setSearchParams]);
}
