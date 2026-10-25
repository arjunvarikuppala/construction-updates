import { Router } from 'express';
import {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  getProjectAssignments,
  assignProjectInCharge,
  removeProjectAssignment,
} from '../controllers/projectController.js';
import { authenticate, requireMD } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Listing accessible to both MD and In-Charge (filtered per role)
router.get('/', listProjects);
router.get('/:id', getProjectById);

// Creation and modification restricted to MD
router.post('/', requireMD, createProject);
router.put('/:id', requireMD, updateProject);

// Assignment management restricted to MD
router.get('/:id/assignments', getProjectAssignments);
router.post('/:id/assignments', requireMD, assignProjectInCharge);
router.delete('/:id/assignments/:siteInChargeId', requireMD, removeProjectAssignment);

export default router;
