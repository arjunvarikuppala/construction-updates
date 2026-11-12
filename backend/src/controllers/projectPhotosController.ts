/**
 * GET /projects/:id/photos?from=YYYY-MM-DD&before=<ISO workDate>&beforeId=<reportId>&limit=20
 *
 * Project gallery: every photo / video the site in-charge attached to the project's
 * submitted daily reports, newest work date first, one group per report.
 * Paged by report (cursor = last report's workDate + _id). The first page (no cursor)
 * also returns the total photo count and how many reports have photos.
 * Visible to anyone with access to the project (MD, or an assigned in-charge).
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types/index.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { DailyReport } from '../models/DailyReport.js';

const MAX_LIMIT = 40;

export interface ProjectPhotoGroup {
  reportId: string;
  workDate: string;
  titleOfWork: string;
  postedBy: string;
  photos: Array<{ url: string; caption?: string; uploadedAt?: string }>;
}

export async function listProjectPhotos(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const access = await verifyUserProjectAccess(String(req.params.id), req.user!.userId, req.user!.role);
    if (!access.allowed || !access.project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 20));
    const base: any = {
      project: access.project._id,
      status: 'SUBMITTED',
      'photos.0': { $exists: true },
    };
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : '';
    if (from) base.workDate = { $gte: new Date(`${from}T00:00:00+05:30`) };

    const query: any = { ...base };
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    const beforeId = typeof req.query.beforeId === 'string' && mongoose.isValidObjectId(req.query.beforeId) ? req.query.beforeId : '';
    const hasCursor = Boolean(before && !Number.isNaN(before.getTime()) && beforeId);
    if (hasCursor) {
      query.$or = [
        { workDate: { $lt: before } },
        { workDate: before, _id: { $lt: new mongoose.Types.ObjectId(beforeId) } },
      ];
    }

    const reports = await DailyReport.find(query)
      .sort({ workDate: -1, _id: -1 })
      .limit(limit + 1)
      .select('workDate titleOfWork photos submittedBy')
      .populate('submittedBy', 'name')
      .lean();

    const hasMore = reports.length > limit;
    const page = reports.slice(0, limit);
    const groups: ProjectPhotoGroup[] = page.map((r: any) => ({
      reportId: String(r._id),
      workDate: new Date(r.workDate).toISOString(),
      titleOfWork: r.titleOfWork || '',
      postedBy: (r.submittedBy && typeof r.submittedBy === 'object' && r.submittedBy.name) || 'Site in-charge',
      photos: (r.photos || [])
        .filter((p: any) => p && p.url)
        .map((p: any) => ({
          url: p.url,
          caption: p.caption || undefined,
          uploadedAt: p.uploadedAt ? new Date(p.uploadedAt).toISOString() : undefined,
        })),
    }));

    const last = page[page.length - 1] as any;
    let totals: { photos: number; reports: number } | undefined;
    if (!hasCursor) {
      const [agg] = await DailyReport.aggregate([
        { $match: base },
        { $group: { _id: null, photos: { $sum: { $size: '$photos' } }, reports: { $sum: 1 } } },
      ]);
      totals = { photos: agg?.photos || 0, reports: agg?.reports || 0 };
    }

    res.json({
      success: true,
      groups,
      hasMore,
      nextCursor: hasMore && last ? { before: new Date(last.workDate).toISOString(), beforeId: String(last._id) } : null,
      totals,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to load project photos', error: error.message });
  }
}

/** Photo count per project (submitted reports only), for the project cards. */
export async function countPhotosByProject(projectIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (projectIds.length === 0) return out;
  const rows = await DailyReport.aggregate([
    { $match: { project: { $in: projectIds }, status: 'SUBMITTED', 'photos.0': { $exists: true } } },
    { $group: { _id: '$project', n: { $sum: { $size: '$photos' } } } },
  ]);
  rows.forEach((r) => out.set(String(r._id), r.n));
  return out;
}
