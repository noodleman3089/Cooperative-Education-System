import { query } from '../config/database';
import { JobPost } from '../types';

export interface JobPostWithCompany extends JobPost {
  company_name_th: string;
  company_name_en: string | null;
}

export class JobPostModel {
  /**
   * Create a new job post. Defaults to 'pending_approval'.
   */
  static async create(jobData: {
    company_id: number;
    title: string;
    description: string;
    created_by: number;
    quota: number;
    expire_date: Date | string;
  }): Promise<JobPost> {
    const res = await query(
      `INSERT INTO job_posts (company_id, title, description, created_by, quota, applied_count, expire_date, status)
       VALUES ($1, $2, $3, $4, $5, 0, $6, 'pending_approval')
       RETURNING job_id, company_id, title, description, created_by, quota, applied_count, expire_date, status`,
      [
        jobData.company_id,
        jobData.title,
        jobData.description,
        jobData.created_by,
        jobData.quota,
        jobData.expire_date,
      ]
    );
    return res.rows[0] as JobPost;
  }

  /**
   * Find a job post by its ID.
   */
  static async findById(jobId: number): Promise<JobPost | null> {
    const res = await query(
      `SELECT job_id, company_id, title, description, created_by, quota, applied_count, expire_date, status, reject_reason
       FROM job_posts
       WHERE job_id = $1`,
      [jobId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as JobPost;
  }

  /**
   * Publish a job post (setting its status to 'published').
   */
  static async publish(jobId: number): Promise<boolean> {
    const res = await query(
      `UPDATE job_posts
       SET status = 'published', reject_reason = NULL
       WHERE job_id = $1`,
      [jobId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Turn a job post down. The reason is stored on the row rather than only in
   * the audit log, because the company that wrote the posting is the one who
   * needs to read it, and there is no read API for `audit_log` by design.
   */
  static async reject(jobId: number, reason: string): Promise<boolean> {
    const res = await query(
      `UPDATE job_posts
       SET status = 'rejected', reject_reason = $2
       WHERE job_id = $1`,
      [jobId, reason]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Fetch all jobs that are published, have remaining quota, and have not expired yet.
   * Joins with the companies table to provide company names.
   */
  static async getAvailableJobs(): Promise<JobPostWithCompany[]> {
    const res = await query(
      `SELECT j.job_id, j.company_id, j.title, j.description, j.created_by,
              j.quota, j.applied_count, j.expire_date, j.status, j.duration_term,
              c.name_th as company_name_th, c.name_en as company_name_en
       FROM job_posts j
       JOIN companies c ON j.company_id = c.company_id
       WHERE j.status = 'published'
         AND j.applied_count < j.quota
         -- ⛔ **เลิกกรองด้วย expire_date แล้ว** — คอลัมน์นี้เปลี่ยนความหมายไปตั้งแต่
         --    รอบรื้อฝ่ายสถานประกอบการ จาก "วันที่ประกาศหมดอายุ" เป็น
         --    **"กำหนดส่งแบบสำรวจกลับ"** (ตามบรรทัดท้ายกระดาษ สหกิจ 02)
         --    การใช้มันกรองกระดานหางานจึงกลับหัว: ตำแหน่งจะหายจากกระดานทันทีที่
         --    เลยวันปิดรับแบบสำรวจ ทั้งที่นักศึกษาเพิ่งจะเริ่มสมัครได้หลังจากนั้น
         --    (เจอตอนทดสอบ: กระดานว่างเปล่าทั้งที่มีตำแหน่งที่เจ้าหน้าที่เปิดให้เห็นแล้ว)
         --    ตัวที่คุมว่ายังรับอยู่ไหมคือ status กับโควตา ส่วนภาคเรียนคุมด้วยเงื่อนไขล่าง
         -- ⛔ ต้องเป็นตำแหน่งของภาคเรียนที่กำลังเปิดรับ ไม่ใช่ของภาคที่ผ่านไปแล้ว
         --    ก่อนหน้านี้ job_posts ไม่มี semester_id เลย กระดานหางานจึงสะสมของทุกภาค
         --    ปนกันไปเรื่อย ๆ และนักศึกษาสมัครตำแหน่งของปีที่แล้วได้
         --    · แถวที่ semester_id เป็น NULL คือของเก่าก่อนมีระบบใบสำรวจ ยอมให้ผ่าน
         --      เพราะการซ่อนทั้งกระดานเสียหายกว่าการโชว์ของเก่าไม่กี่รายการ
         AND (
           j.semester_id IS NULL
           OR j.semester_id = (SELECT semester_id FROM coop_semesters
                                WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1)
         )
         -- ⛔ บริษัทที่ตอบว่า "ภาคเรียนนี้ยังไม่รับ" ต้องไม่โผล่ในกระดาน
         --    แม้จะมีรายการค้างจากตอนที่ยังไม่ได้ตอบก็ตาม
         AND NOT EXISTS (
           SELECT 1 FROM coop_job_offers o
            WHERE o.offer_id = j.offer_id AND o.status = 'declined'
         )
       ORDER BY j.job_id DESC`
    );
    return res.rows as JobPostWithCompany[];
  }

  /**
   * Fetch job posts with filters (e.g. status or creator).
   */
  static async getJobsWithFilters(filters: {
    created_by?: number;
    status?: string;
  }): Promise<JobPostWithCompany[]> {
    let queryStr = `
      SELECT j.job_id, j.company_id, j.title, j.description, j.created_by,
             j.quota, j.applied_count, j.expire_date, j.status, j.reject_reason,
             c.name_th as company_name_th, c.name_en as company_name_en
      FROM job_posts j
      JOIN companies c ON j.company_id = c.company_id
      WHERE 1=1
    `;
    const queryParams: unknown[] = [];

    if (filters.created_by !== undefined) {
      queryParams.push(filters.created_by);
      queryStr += ` AND j.created_by = $${queryParams.length}`;
    }

    if (filters.status !== undefined) {
      queryParams.push(filters.status);
      queryStr += ` AND j.status = $${queryParams.length}`;
    }

    queryStr += ` ORDER BY j.job_id DESC`;

    const res = await query(queryStr, queryParams);
    return res.rows as JobPostWithCompany[];
  }
}
