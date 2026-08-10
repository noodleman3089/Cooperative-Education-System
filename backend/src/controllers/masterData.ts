import { Request, Response } from 'express';
import { MasterModel } from '../models/master';

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
      console.error('Error fetching master data:', error);
      res.status(500).json({ message: 'An internal server error occurred while retrieving master data.' });
    }
  }
}
