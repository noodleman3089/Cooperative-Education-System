import { Request, Response } from 'express';
import { CoopSemesterModel } from '../models/semester';

export class CoopSemesterController {
  /**
   * Get the current active cooperative education semester.
   * Route: GET /api/semesters/active
   * Access: Public (or Token authenticated)
   */
  static async getActiveSemester(_req: Request, res: Response): Promise<void> {
    try {
      const activeSemester = await CoopSemesterModel.findActiveSemester();
      if (!activeSemester) {
        res.status(404).json({ message: 'No active cooperative semester found.' });
        return;
      }
      res.status(200).json(activeSemester);
    } catch (error) {
      console.error('Get Active Semester Error:', error);
      res.status(500).json({ message: 'An internal server error occurred while retrieving active semester.' });
    }
  }
}
