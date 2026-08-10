import { query } from '../config/database';

export interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  image_url: string | null;
  is_pinned: boolean;
  created_by: number;
  created_at: string;
  author_name?: string;
}

export class AnnouncementModel {
  /**
   * Fetch all announcements, pinned first, then latest created_at.
   */
  static async getAll(): Promise<Announcement[]> {
    const res = await query(
      `SELECT a.announcement_id, a.title, a.content, a.image_url, a.is_pinned, a.created_by, a.created_at,
              COALESCE(p.first_name || ' ' || p.last_name, u.email) as author_name
       FROM announcements a
       JOIN users u ON a.created_by = u.user_id
       LEFT JOIN personnel p ON u.user_id = p.personnel_id
       ORDER BY a.is_pinned DESC, a.created_at DESC`
    );
    return res.rows as Announcement[];
  }

  /**
   * Create a new PR announcement.
   */
  static async create(data: {
    title: string;
    content: string;
    image_url?: string | null;
    is_pinned?: boolean;
    created_by: number;
  }): Promise<Announcement> {
    const res = await query(
      `INSERT INTO announcements (title, content, image_url, is_pinned, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING announcement_id, title, content, image_url, is_pinned, created_by, created_at`,
      [
        data.title,
        data.content,
        data.image_url || null,
        data.is_pinned || false,
        data.created_by
      ]
    );
    return res.rows[0] as Announcement;
  }

  /**
   * Delete an announcement by ID.
   */
  static async delete(announcementId: number): Promise<boolean> {
    const res = await query(
      `DELETE FROM announcements WHERE announcement_id = $1`,
      [announcementId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Toggle pinned status of an announcement.
   */
  static async togglePin(announcementId: number): Promise<Announcement | null> {
    const res = await query(
      `UPDATE announcements 
       SET is_pinned = NOT is_pinned 
       WHERE announcement_id = $1
       RETURNING announcement_id, title, content, image_url, is_pinned, created_by, created_at`,
      [announcementId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Announcement;
  }
}
