import { Request, Response } from 'express';
import { MajorBlockers, MasterModel } from '../models/master';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

export class MasterDataController {
  /**
   * Get all master data (faculties, majors, provinces) for frontend dropdowns.
   * Route: GET /api/master-data
   */
  static async getMasterData(_req: Request, res: Response): Promise<void> {
    try {
      // Fetch all master lists concurrently to optimize database access time
      const [faculties, majors, provinces, semesters] = await Promise.all([
        MasterModel.getFaculties(),
        MasterModel.getMajors(),
        MasterModel.getProvinces(),
        MasterModel.getSemesters()
      ]);

      res.status(200).json({
        faculties,
        majors,
        provinces,
        semesters,
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Error fetching master data', 'An internal server error occurred while retrieving master data.');
    }
  }

  /* ── ทะเบียนคณะและสาขา (SB7) — role `staff` เท่านั้น ────────────────
   *
   * ⛔ `GET /` ข้างบนเปิดสาธารณะโดยตั้งใจ (หน้าสมัคร/หน้าล็อกอินใช้เติม dropdown)
   *    เส้นที่**เขียน**ทั้งหมดจึงต้องแปะ `authenticateToken` + `authorizeRoles('staff')`
   *    ทีละเส้นใน `routes/masterData.ts` ห้ามพึ่งด่านระดับไฟล์ที่ไม่มีอยู่
   */

  /** POST /api/master-data/faculties */
  static async createFaculty(req: Request, res: Response): Promise<void> {
    try {
      const name = readName(req.body?.faculty_name_th);
      if (!name) {
        res.status(400).json({ message: 'กรุณากรอกชื่อคณะ' });
        return;
      }
      const clash = await MasterModel.findFacultyByName(name);
      if (clash) {
        res.status(409).json({ message: `มีคณะชื่อ “${clash.faculty_name_th}” อยู่แล้ว` });
        return;
      }

      const faculty = await MasterModel.createFaculty(name);
      writeAudit(
        {
          action: AuditAction.MASTER_FACULTY_CREATED,
          entityType: 'master_faculty',
          entityId: faculty.faculty_id,
          detail: { faculty_name_th: faculty.faculty_name_th },
        },
        req
      ).catch(() => undefined);

      res.status(201).json(faculty);
    } catch (error) {
      sendUnexpectedError(res, error, 'Create faculty error', 'ไม่สามารถเพิ่มคณะได้');
    }
  }

  /** PUT /api/master-data/faculties/:id */
  static async updateFaculty(req: Request, res: Response): Promise<void> {
    try {
      const facultyId = readId(req.params.id);
      if (facultyId === null) {
        res.status(400).json({ message: 'รหัสคณะไม่ถูกต้อง' });
        return;
      }
      const name = readName(req.body?.faculty_name_th);
      if (!name) {
        res.status(400).json({ message: 'กรุณากรอกชื่อคณะ' });
        return;
      }
      const before = await MasterModel.findFaculty(facultyId);
      if (!before) {
        res.status(404).json({ message: 'ไม่พบคณะนี้' });
        return;
      }
      const clash = await MasterModel.findFacultyByName(name, facultyId);
      if (clash) {
        res.status(409).json({ message: `มีคณะชื่อ “${clash.faculty_name_th}” อยู่แล้ว` });
        return;
      }

      const faculty = await MasterModel.updateFaculty(facultyId, name);
      writeAudit(
        {
          action: AuditAction.MASTER_FACULTY_UPDATED,
          entityType: 'master_faculty',
          entityId: facultyId,
          // ⛔ ชื่อคณะถูกพิมพ์ลงหนังสือราชการ — "ใครเปลี่ยนจากอะไรเป็นอะไร" ต้องตามย้อนได้
          detail: { previous: before.faculty_name_th, current: faculty.faculty_name_th },
        },
        req
      ).catch(() => undefined);

      res.status(200).json(faculty);
    } catch (error) {
      sendUnexpectedError(res, error, 'Update faculty error', 'ไม่สามารถแก้ไขชื่อคณะได้');
    }
  }

  /**
   * DELETE /api/master-data/faculties/:id
   *
   * ⛔ `master_major.faculty_id` เป็น `ON DELETE CASCADE` — ลบคณะคือลบสาขาใต้คณะ
   *    ทั้งหมดไปด้วยเงียบ ๆ · จึงต้องกันเองที่นี่ ไม่ใช่ปล่อยให้ฐานทำ
   *    และต้องคืนรายชื่อสาขาที่หายไปเพื่อให้หน้าจอเตือนได้ว่าจะลบอะไรบ้าง
   */
  static async deleteFaculty(req: Request, res: Response): Promise<void> {
    try {
      const facultyId = readId(req.params.id);
      if (facultyId === null) {
        res.status(400).json({ message: 'รหัสคณะไม่ถูกต้อง' });
        return;
      }
      const faculty = await MasterModel.findFaculty(facultyId);
      if (!faculty) {
        res.status(404).json({ message: 'ไม่พบคณะนี้' });
        return;
      }

      const majors = await MasterModel.majorsOfFaculty(facultyId);
      const blocked = (await MasterModel.majorBlockers(majors.map((m) => m.major_id))).filter(
        isBlocked
      );
      if (blocked.length > 0) {
        res.status(409).json({
          message: `ลบคณะ “${faculty.faculty_name_th}” ไม่ได้ เพราะสาขาใต้คณะยังมีข้อมูลผูกอยู่: ${blocked
            .map((b) => `${b.major_name_th} (${blockerSummary(b)})`)
            .join(' · ')}`,
        });
        return;
      }

      await MasterModel.deleteFaculty(facultyId);
      writeAudit(
        {
          action: AuditAction.MASTER_FACULTY_DELETED,
          entityType: 'master_faculty',
          entityId: facultyId,
          detail: { faculty_name_th: faculty.faculty_name_th, deleted_majors: majors },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message:
          majors.length > 0
            ? `ลบคณะ “${faculty.faculty_name_th}” พร้อมสาขาใต้คณะ ${majors.length} สาขาเรียบร้อยแล้ว`
            : `ลบคณะ “${faculty.faculty_name_th}” เรียบร้อยแล้ว`,
        deleted_majors: majors,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Delete faculty error', 'ไม่สามารถลบคณะได้');
    }
  }

  /** POST /api/master-data/majors */
  static async createMajor(req: Request, res: Response): Promise<void> {
    try {
      const parsed = await parseMajorBody(req.body);
      if ('error' in parsed) {
        res.status(parsed.status).json({ message: parsed.error });
        return;
      }
      const clash = await MasterModel.findMajorByCode(parsed.code);
      if (clash) {
        res.status(409).json({
          message: `รหัส ${clash.major_code} ซ้ำกับสาขา ${clash.major_name_th}`,
        });
        return;
      }

      const major = await MasterModel.createMajor(parsed.facultyId, parsed.code, parsed.name);
      writeAudit(
        {
          action: AuditAction.MASTER_MAJOR_CREATED,
          entityType: 'master_major',
          entityId: major.major_id,
          detail: major,
        },
        req
      ).catch(() => undefined);

      res.status(201).json(major);
    } catch (error) {
      sendUnexpectedError(res, error, 'Create major error', 'ไม่สามารถเพิ่มสาขาวิชาได้');
    }
  }

  /** PUT /api/master-data/majors/:id */
  static async updateMajor(req: Request, res: Response): Promise<void> {
    try {
      const majorId = readId(req.params.id);
      if (majorId === null) {
        res.status(400).json({ message: 'รหัสสาขาวิชาไม่ถูกต้อง' });
        return;
      }
      const before = await MasterModel.findMajor(majorId);
      if (!before) {
        res.status(404).json({ message: 'ไม่พบสาขาวิชานี้' });
        return;
      }
      const parsed = await parseMajorBody(req.body);
      if ('error' in parsed) {
        res.status(parsed.status).json({ message: parsed.error });
        return;
      }
      const clash = await MasterModel.findMajorByCode(parsed.code, majorId);
      if (clash) {
        res.status(409).json({
          message: `รหัส ${clash.major_code} ซ้ำกับสาขา ${clash.major_name_th}`,
        });
        return;
      }

      const major = await MasterModel.updateMajor(majorId, parsed.facultyId, parsed.code, parsed.name);
      writeAudit(
        {
          action: AuditAction.MASTER_MAJOR_UPDATED,
          entityType: 'master_major',
          entityId: majorId,
          detail: { previous: before, current: major },
        },
        req
      ).catch(() => undefined);

      res.status(200).json(major);
    } catch (error) {
      sendUnexpectedError(res, error, 'Update major error', 'ไม่สามารถแก้ไขสาขาวิชาได้');
    }
  }

  /** DELETE /api/master-data/majors/:id */
  static async deleteMajor(req: Request, res: Response): Promise<void> {
    try {
      const majorId = readId(req.params.id);
      if (majorId === null) {
        res.status(400).json({ message: 'รหัสสาขาวิชาไม่ถูกต้อง' });
        return;
      }
      const major = await MasterModel.findMajor(majorId);
      if (!major) {
        res.status(404).json({ message: 'ไม่พบสาขาวิชานี้' });
        return;
      }

      const blocked = (await MasterModel.majorBlockers([majorId])).filter(isBlocked);
      if (blocked.length > 0) {
        res.status(409).json({
          message: `ลบสาขา “${major.major_name_th}” ไม่ได้ เพราะยังมี${blockerSummary(
            blocked[0]
          )}ผูกอยู่ — ย้ายข้อมูลเหล่านี้ไปสาขาอื่นก่อน`,
        });
        return;
      }

      await MasterModel.deleteMajor(majorId);
      writeAudit(
        {
          action: AuditAction.MASTER_MAJOR_DELETED,
          entityType: 'master_major',
          entityId: majorId,
          detail: major,
        },
        req
      ).catch(() => undefined);

      res.status(200).json({ message: `ลบสาขา “${major.major_name_th}” เรียบร้อยแล้ว` });
    } catch (error) {
      sendUnexpectedError(res, error, 'Delete major error', 'ไม่สามารถลบสาขาวิชาได้');
    }
  }
}

/* ── ตัวช่วยของไฟล์นี้ ─────────────────────────────────────────────── */

function readId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function isBlocked(b: MajorBlockers): boolean {
  return b.student_count > 0 || b.personnel_count > 0;
}

/** บอกว่าติดอะไรกี่รายการ ไม่ใช่ "มีข้อมูลผูกอยู่" ลอย ๆ ที่ไม่บอกว่าต้องไปแก้ที่ไหน */
function blockerSummary(b: MajorBlockers): string {
  const parts: string[] = [];
  if (b.student_count > 0) parts.push(`นักศึกษา ${b.student_count} คน`);
  if (b.personnel_count > 0) parts.push(`บุคลากร ${b.personnel_count} คน`);
  return parts.join(' · ');
}

async function parseMajorBody(
  body: unknown
): Promise<{ facultyId: number; code: string; name: string } | { error: string; status: number }> {
  const raw = (body ?? {}) as Record<string, unknown>;

  const facultyId =
    typeof raw.faculty_id === 'number' ? raw.faculty_id : parseInt(String(raw.faculty_id), 10);
  if (!Number.isInteger(facultyId) || facultyId <= 0) {
    return { error: 'กรุณาเลือกคณะที่สาขานี้สังกัด', status: 400 };
  }
  if (!(await MasterModel.findFaculty(facultyId))) {
    return { error: 'ไม่พบคณะที่เลือก', status: 404 };
  }

  const code = readName(raw.major_code);
  if (!code) return { error: 'กรุณากรอกรหัสสาขาวิชา', status: 400 };

  const name = readName(raw.major_name_th);
  if (!name) return { error: 'กรุณากรอกชื่อสาขาวิชา', status: 400 };

  return { facultyId, code, name };
}
