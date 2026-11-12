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
import {
  getProjectWeather,
  getWeatherSummary,
  updateProjectLocation,
  geocodeLocationQuery,
} from '../controllers/weatherController.js';
import { searchProject } from '../controllers/projectSearchController.js';
import { authenticate, requireMD } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Specific routes registered before parameterized /:id routes
router.get('/weather-summary', getWeatherSummary);
router.post('/geocode', geocodeLocationQuery);

// Listing accessible to both MD and In-Charge (filtered per role)
router.get('/', listProjects);
router.get('/:id', getProjectById);

// Weather for a specific project
router.get('/:id/weather', getProjectWeather);

// Search everything recorded on a project (work, labour, materials, machinery, payments, expenses)
router.get('/:id/search', searchProject);

// Location configuration for a project (MD only)
router.put('/:id/location', requireMD, updateProjectLocation);

// Creation and modification restricted to MD
router.post('/', requireMD, createProject);
router.put('/:id', requireMD, updateProject);

// Assignment management restricted to MD
router.get('/:id/assignments', getProjectAssignments);
router.post('/:id/assignments', requireMD, assignProjectInCharge);
router.delete('/:id/assignments/:siteInChargeId', requireMD, removeProjectAssignment);

export default router;
