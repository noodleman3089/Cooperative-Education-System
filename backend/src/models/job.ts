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
    image_path?: string | null;
    created_by: number;
    quota: number;
    expire_date: Date | string;
  }): Promise<JobPost> {
    const res = await query(
      `INSERT INTO job_posts (company_id, title, description, image_path, created_by, quota, applied_count, expire_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 'pending_approval')
       RETURNING job_id, company_id, title, description, image_path, created_by, quota, applied_count, expire_date, status`,
      [
        jobData.company_id,
        jobData.title,
        jobData.description,
        jobData.image_path || null,
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
      `SELECT job_id, company_id, title, description, image_path, created_by, quota, applied_count, expire_date, status, reject_reason
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
      `SELECT j.job_id, j.company_id, j.title, j.description, j.image_path, j.created_by, 
              j.quota, j.applied_count, j.expire_date, j.status,
              c.name_th as company_name_th, c.name_en as company_name_en
       FROM job_posts j
       JOIN companies c ON j.company_id = c.company_id
       WHERE j.status = 'published'
         AND j.expire_date > NOW()
         AND j.applied_count < j.quota
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
      SELECT j.job_id, j.company_id, j.title, j.description, j.image_path, j.created_by,
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
