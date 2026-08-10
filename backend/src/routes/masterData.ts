import { Router } from 'express';
import { MasterDataController } from '../controllers/masterData';

const router = Router();

// Route: GET /api/master-data
router.get('/', MasterDataController.getMasterData);

export default router;
