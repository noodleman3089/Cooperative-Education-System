import { Request, Response } from 'express';
import { JobPostModel } from '../models/job';
import { CompanyModel } from '../models/company';
import { CreateJobPostBody } from '../types';
import { writeAudit, AuditAction } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

export class JobPostController {
  /**
   * Create a new job post in 'pending_approval' state.
   * Route: POST /api/jobs
   * Access: staff, advisor, dean, company
   */
  static async createJobPost(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const body = req.body as CreateJobPostBody;
      const { company_id, title, description, image_path, quota, expire_date } = body;

      // Validate inputs
      if (company_id === undefined || !title || !description || quota === undefined || !expire_date) {
        res.status(400).json({ message: 'Required fields: company_id, title, description, quota, expire_date.' });
        return;
      }

      const parsedCompanyId = parseInt(company_id as any, 10);
      const parsedQuota = parseInt(quota as any, 10);

      if (isNaN(parsedCompanyId)) {
        res.status(400).json({ message: 'company_id must be a valid integer.' });
        return;
      }

      if (isNaN(parsedQuota) || parsedQuota <= 0) {
        res.status(400).json({ message: 'quota must be a positive integer.' });
        return;
      }

      // Check that expire date is valid and in the future
      const expireTime = new Date(expire_date).getTime();
      if (isNaN(expireTime)) {
        res.status(400).json({ message: 'expire_date is not a valid date.' });
        return;
      }

      if (expireTime <= Date.now()) {
        res.status(400).json({ message: 'expire_date must be in the future.' });
        return;
      }

      // Verify company exists
      const company = await CompanyModel.findById(parsedCompanyId);
      if (!company) {
        res.status(404).json({ message: 'Referenced company does not exist.' });
        return;
      }

      // Create job post (default status: pending_approval)
      const userId = req.user.userId;

      // SEC-06: company_id came straight from the request body, so a company
      // account could publish postings in another company's name.
      if (req.user.roles.includes('company') && !req.user.roles.some((r) => ['staff', 'dean', 'advisor'].includes(r))) {
        if (company.created_by !== userId) {
          res.status(403).json({ message: 'Forbidden. You can only post jobs for your own company.' });
          return;
        }
      }
      const job = await JobPostModel.create({
        company_id: parsedCompanyId,
        title: title.trim(),
        description: description.trim(),
        image_path: image_path || null,
        created_by: userId,
        quota: parsedQuota,
        expire_date: new Date(expire_date),
      });

      res.status(201).json({
        message: 'Job post created successfully (pending approval).',
        job,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Create Job Post Error', 'An internal server error occurred while creating job post.');
    }
  }

  /**
   * Publish a job post (setting its status to 'published').
   * Route: PUT /api/jobs/:id/publish
   * Access: staff, advisor, dean
   */
  static async publishJobPost(req: Request, res: Response): Promise<void> {
    try {
      const jobId = parseInt(req.params.id, 10);
      if (isNaN(jobId)) {
        res.status(400).json({ message: 'Invalid job ID format.' });
        return;
      }

      // Verify job exists
      const job = await JobPostModel.findById(jobId);
      if (!job) {
        res.status(404).json({ message: 'Job post not found.' });
        return;
      }

      if (job.status === 'published') {
        res.status(200).json({ message: 'Job post is already published.' });
        return;
      }

      // Publish the job post
      await JobPostModel.publish(jobId);

      await writeAudit(
        {
          action: AuditAction.JOB_POST_PUBLISHED,
          entityType: 'job_post',
          entityId: jobId,
          detail: { title: job.title, company_id: job.company_id },
        },
        req
      );

      res.status(200).json({
        message: 'Job post published successfully.',
        job_id: jobId,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Publish Job Post Error', 'An internal server error occurred while publishing the job post.');
    }
  }

  /**
   * Turn a job post down, with a reason the company will read.
   * Route: PUT /api/jobs/:id/reject
   * Access: staff, advisor, dean
   *
   * The reason is mandatory here for the same reason it is mandatory for an
   * advisor and a department head rejecting an intent form: a refusal the author
   * cannot act on is indistinguishable from the system losing their submission.
   */
  static async rejectJobPost(req: Request, res: Response): Promise<void> {
    try {
      const jobId = parseInt(req.params.id, 10);
      if (isNaN(jobId)) {
        res.status(400).json({ message: 'Invalid job ID format.' });
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason) {
        res.status(400).json({ message: 'A rejection reason is required.' });
        return;
      }

      const job = await JobPostModel.findById(jobId);
      if (!job) {
        res.status(404).json({ message: 'Job post not found.' });
        return;
      }

      // Only a posting still awaiting a decision can be refused. Un-publishing a
      // live advert that students may already have applied to is a different
      // action with different consequences, and is not this one.
      if (job.status !== 'pending_approval') {
        res.status(400).json({ message: 'Only a job post awaiting approval can be rejected.' });
        return;
      }

      await JobPostModel.reject(jobId, reason);

      await writeAudit(
        {
          action: AuditAction.JOB_POST_REJECTED,
          entityType: 'job_post',
          entityId: jobId,
          detail: { title: job.title, company_id: job.company_id, reason },
        },
        req
      );

      res.status(200).json({
        message: 'Job post rejected.',
        job_id: jobId,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Reject Job Post Error', 'An internal server error occurred while rejecting the job post.');
    }
  }

  /**
   * Fetch all active published jobs (quota not filled, not expired) or filtered job lists.
   * Route: GET /api/jobs
   * Access: Authenticated users (students, staff, advisors, deans, companies)
   */
  static async getAvailableJobs(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { roles, userId } = req.user;
      const { status, created_by } = req.query;

      // Students can only see active published jobs
      if (roles.includes('student')) {
        const jobs = await JobPostModel.getAvailableJobs();
        res.status(200).json(jobs);
        return;
      }

      // If company is logged in, they see their own jobs unless they filter otherwise
      // But company is restricted to only seeing their own posts
      if (roles.includes('company')) {
        const jobs = await JobPostModel.getJobsWithFilters({ created_by: userId });
        res.status(200).json(jobs);
        return;
      }

      // Staff, Advisors, Deans, Dept Heads can filter by status or creator
      const filters: { created_by?: number; status?: string } = {};
      if (status) {
        filters.status = status as string;
      }
      if (created_by) {
        filters.created_by = parseInt(created_by as string, 10);
      }

      // With no filter these roles get EVERY job, not just the published ones.
      // getAvailableJobs() excludes 'pending_approval', which meant the staff
      // approval queue could never list the posts it exists to approve.
      const jobs = await JobPostModel.getJobsWithFilters(filters);
      res.status(200).json(jobs);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Job Postings Error', 'An internal server error occurred while retrieving job postings.');
    }
  }
}
