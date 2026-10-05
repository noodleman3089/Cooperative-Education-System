/**
 * ป้ายภาคเรียนที่คนอ่าน — ที่เดียวของระบบ
 *
 * `academic_year` ในฐานเป็น **พ.ศ.** เสมอ (CHECK `coop_semesters_year_be` · migration 047)
 * จึงไม่ต้องเดายุคอีกแล้ว · ภาค '3' คือภาคฤดูร้อน
 */
export function semesterLabel(semester: string, academicYear: number): string {
  return semester === '3' ? `ภาคฤดูร้อน/${academicYear}` : `ภาคเรียนที่ ${semester}/${academicYear}`;
}
