import { Router } from 'express';
import { UserController } from '../controllers/user';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Protect all admin endpoints under /api/users to only allow 'staff' roles
router.use(authenticateToken);
router.use(authorizeRoles('staff'));

// Route: GET /api/users (List all accounts)
router.get('/', UserController.getAllUsers);

// Route: GET /api/users/:id (View single account)
router.get('/:id', UserController.getUserById);

// Route: POST /api/users (Manual create account with password)
router.post('/', UserController.createUser);

// Route: POST /api/users/:id/resend-invite (Reissue an external partner's invitation link)
router.post('/:id/resend-invite', UserController.resendInvite);

// Route: PUT /api/users/:id (Update account email/role/is_active)
router.put('/:id', UserController.updateUser);

// Route: DELETE /api/users/:id (Remove user account)
router.delete('/:id', UserController.deleteUser);

// Route: POST /api/users/import (Import multiple accounts from JSON/CSV)
router.post('/import', UserController.importUsers);

export default router;
