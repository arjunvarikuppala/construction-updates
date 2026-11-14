import { Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { WeatherService } from '../services/weatherService.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';

/**
 * GET /api/v1/projects/:projectId/weather
 * Retrieve real-time or cached weather for a single authorized project
 */
export async function getProjectWeather(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, id } = req.params;
    const targetId = projectId || id;
    const user = req.user!;

    if (!targetId) {
      res.status(400).json({ success: false, message: 'Project ID is required' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(targetId, user.userId, user.role);

    if (!accessCheck.allowed) {
      if (accessCheck.reason === 'NOT_FOUND' || accessCheck.reason === 'INVALID_ID') {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      res.status(403).json({
        success: false,
        message: 'Access denied: You do not have permission to view weather for this project.',
      });
      return;
    }

    const project = accessCheck.project!;
    const forceRefresh = req.query.refresh === 'true';

    const result = await WeatherService.getProjectWeather(project, { forceRefresh });

    res.json({
      success: true,
      project: {
        id: project._id,
        name: project.name,
        code: project.code,
        location: project.location,
        address: project.address,
        city: project.city,
        state: project.state,
        country: project.country,
        coordinates: {
          latitude: project.latitude ?? null,
          longitude: project.longitude ?? null,
        },
      },
      isConfigured: result.isConfigured,
      weather: result.weather,
      cached: result.cached,
      isStale: result.isStale,
      fetchedAt: result.fetchedAt,
      statusMessage: result.statusMessage,
    });
  } catch (error: any) {
    console.error('Error in getProjectWeather:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve project weather', error: error.message });
  }
}

/**
 * PUT /api/v1/projects/:projectId/location
 * Configure and update project site address, city, state, country, and coordinates
 */
export async function updateProjectLocation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, id } = req.params;
    const targetId = projectId || id;
    const user = req.user!;

    if (!targetId) {
      res.status(400).json({ success: false, message: 'Project ID is required' });
      return;
    }

    const project = await Project.findById(targetId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // Authorization: Must be MD / owner or creator
    const isOwner =
      project.createdBy.toString() === user.userId ||
      (project.owner && project.owner.toString() === user.userId);

    if (!isMD(user.role) || !isOwner) {
      res.status(403).json({
        success: false,
        message: 'Access denied: Only authorized Managing Directors can update project locations.',
      });
      return;
    }

    const { location, address, city, state, country } = req.body;
    const locationString = String(location || address || '').trim();

    if (!locationString) {
      res.status(400).json({
        success: false,
        message: 'Construction site location or address is required.',
      });
      return;
    }

    // Automatically resolve location text to coordinates via backend geocoding service
    const resolved = await WeatherService.resolveLocationText(locationString);
    if (!resolved.resolved || resolved.latitude === undefined || resolved.longitude === undefined) {
      res.status(400).json({
        success: false,
        message: resolved.error || `Unable to resolve construction site location '${locationString}'. Please verify the spelling or enter a recognized city or area (e.g. 'Gachibowli, Hyderabad, Telangana, India').`,
      });
      return;
    }

    // Save location details and store coordinates internally
    project.location = locationString;
    project.latitude = resolved.latitude;
    project.longitude = resolved.longitude;
    if (address !== undefined) project.address = String(address).trim();
    if (city !== undefined) project.city = String(city).trim();
    else if (resolved.city) project.city = resolved.city;
    if (state !== undefined) project.state = String(state).trim();
    else if (resolved.state) project.state = resolved.state;
    if (country !== undefined) project.country = String(country).trim();
    else if (resolved.country) project.country = resolved.country;

    await project.save();

    // Invalidate weather cache for this project so the new coordinates are queried immediately
    await WeatherService.invalidateCache(project._id.toString());

    // Fetch immediate fresh weather for the new location
    const freshWeather = await WeatherService.getProjectWeather(project, { forceRefresh: true });

    await logAudit('PROJECT_UPDATED', user.userId, 'PROJECT', project._id, {
      field: 'location',
      location: project.location,
      latitude: project.latitude,
      longitude: project.longitude,
    });

    res.json({
      success: true,
      message: 'Project location updated successfully and weather cache refreshed.',
      project,
      weather: freshWeather,
    });
  } catch (error: any) {
    console.error('Error in updateProjectLocation:', error);
    res.status(500).json({ success: false, message: 'Failed to update project location', error: error.message });
  }
}

/**
 * POST /api/v1/projects/geocode
 * Search and geocode locations for interactive validation
 */
export async function geocodeLocationQuery(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ success: false, message: 'Query string is required for geocoding' });
      return;
    }

    const results = await WeatherService.geocode(query.trim());
    res.json({ success: true, count: results.length, results });
  } catch (error: any) {
    console.error('Error in geocodeLocationQuery:', error);
    res.status(500).json({ success: false, message: 'Geocoding request failed', error: error.message });
  }
}
