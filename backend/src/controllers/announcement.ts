import { Request, Response } from 'express';
import { AnnouncementModel } from '../models/announcement';
import { query } from '../config/database';
import { sendUnexpectedError } from '../utils/httpError';

/** The co-op office administers all announcements; everyone else only their own. */
const canManageAnnouncement = (
  user: { userId: number; roles: string[] },
  createdBy: number
): boolean => user.roles.some((r) => ['staff', 'dean'].includes(r)) || user.userId === createdBy;

export class AnnouncementController {
  /**
   * Fetch all announcements.
   * Route: GET /api/announcements
   * Access: authenticated users
   */
  static async getAnnouncements(_req: Request, res: Response): Promise<void> {
    try {
      const announcements = await AnnouncementModel.getAll();
      res.status(200).json({ success: true, data: announcements });
    } catch (err) {
      sendUnexpectedError(res, err, 'getAnnouncements error', 'Internal server error while fetching announcements.');
    }
  }

  /**
   * Create a new PR announcement.
   * Route: POST /api/announcements
   * Access: staff, advisor, dean, dept_head
   */
  static async createAnnouncement(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { title, content, image_url, is_pinned } = req.body;
      if (!title || !content) {
        res.status(400).json({ message: 'Title and content are required.' });
        return;
      }

      const newAnnouncement = await AnnouncementModel.create({
        title: title.trim(),
        content: content.trim(),
        image_url: image_url || null,
        is_pinned: !!is_pinned,
        created_by: req.user.userId
      });

      res.status(201).json({
        message: 'PR Announcement created successfully.',
        announcement: newAnnouncement
      });
    } catch (err) {
      sendUnexpectedError(res, err, 'createAnnouncement error', 'Internal server error while creating announcement.');
    }
  }

  /**
   * Delete an announcement.
   * Route: DELETE /api/announcements/:id
   * Access: staff, advisor, dean, dept_head
   */
  static async deleteAnnouncement(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const announcementId = parseInt(req.params.id, 10);
      if (isNaN(announcementId)) {
        res.status(400).json({ message: 'Invalid announcement ID.' });
        return;
      }

      // SEC-06: any advisor could previously delete a co-op office announcement.
      // Only the author or the co-op office (staff/dean) may remove one.
      const ownerRes = await query('SELECT created_by FROM announcements WHERE announcement_id = $1', [announcementId]);
      if ((ownerRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Announcement not found.' });
        return;
      }
      if (!canManageAnnouncement(req.user, ownerRes.rows[0].created_by)) {
        res.status(403).json({ message: 'Forbidden. You can only remove announcements you created.' });
        return;
      }

      const deleted = await AnnouncementModel.delete(announcementId);
      if (!deleted) {
        res.status(404).json({ message: 'Announcement not found.' });
        return;
      }

      res.status(200).json({ message: 'Announcement deleted successfully.' });
    } catch (err) {
      sendUnexpectedError(res, err, 'deleteAnnouncement error', 'Internal server error while deleting announcement.');
    }
  }

  /**
   * Toggle pinned status of an announcement.
   * Route: PATCH /api/announcements/:id/pin
   * Access: staff, advisor, dean, dept_head
   */
  static async togglePin(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const announcementId = parseInt(req.params.id, 10);
      if (isNaN(announcementId)) {
        res.status(400).json({ message: 'Invalid announcement ID.' });
        return;
      }

      const ownerRes = await query('SELECT created_by FROM announcements WHERE announcement_id = $1', [announcementId]);
      if ((ownerRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Announcement not found.' });
        return;
      }
      if (!canManageAnnouncement(req.user, ownerRes.rows[0].created_by)) {
        res.status(403).json({ message: 'Forbidden. You can only pin announcements you created.' });
        return;
      }

      const updated = await AnnouncementModel.togglePin(announcementId);
      if (!updated) {
        res.status(404).json({ message: 'Announcement not found.' });
        return;
      }

      res.status(200).json({
        message: `Announcement ${updated.is_pinned ? 'pinned' : 'unpinned'} successfully.`,
        announcement: updated
      });
    } catch (err) {
      sendUnexpectedError(res, err, 'togglePin error', 'Internal server error while updating announcement pin.');
    }
  }
}
