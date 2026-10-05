/**
 * ป้ายภาคเรียน — คู่ของ `backend/src/utils/semesterLabel.ts` (สองฝั่งต้องเหมือนกัน)
 * `academic_year` เป็น พ.ศ. เสมอแล้ว (migration 047) ห้ามบวก 543 ซ้ำ · ภาค '3' = ฤดูร้อน
 */
export const semesterLabel = (semester: string, academicYear: number): string =>
  semester === '3' ? `ภาคฤดูร้อน/${academicYear}` : `ภาคเรียนที่ ${semester}/${academicYear}`;
