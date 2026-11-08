/**
 * Tenant (company) scoping helpers.
 *
 * SiteTrack has no separate Company collection: a "company" is the MD/Owner
 * account that created or owns a set of projects. Every query that returns
 * project-linked data must be limited to the projects the caller can access:
 *   - MD / OWNER    → projects they created or own
 *   - SITE_INCHARGE → projects with an ACTIVE assignment (legacy assignedInCharge
 *                     is honoured only when no REVOKED assignment exists)
 */
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { User } from '../models/User.js';
import { AuthUserPayload, isMD, isSiteInCharge } from '../types/index.js';

const oid = (id: string | mongoose.Types.ObjectId) => new mongoose.Types.ObjectId(String(id));

/** Mongo filter selecting the projects an MD owns. */
export function mdProjectFilter(mdUserId: string) {
  return { $or: [{ createdBy: oid(mdUserId) }, { owner: oid(mdUserId) }] };
}

/** Project IDs the caller is allowed to read. Empty array for unknown roles. */
export async function getAccessibleProjectIds(
  user: Pick<AuthUserPayload, 'userId' | 'role'>
): Promise<mongoose.Types.ObjectId[]> {
  if (isMD(user.role)) {
    const projects = await Project.find(mdProjectFilter(user.userId)).select('_id');
    return projects.map((p) => p._id as mongoose.Types.ObjectId);
  }

  if (isSiteInCharge(user.role)) {
    const assignments = await ProjectAssignment.find({ siteInCharge: oid(user.userId) }).select(
      'project assignmentStatus'
    );
    const revoked = new Set<string>();
    const active = new Set<string>();
    assignments.forEach((a) => {
      const pid = a.project.toString();
      if (a.assignmentStatus === 'REVOKED') revoked.add(pid);
      else active.add(pid);
    });
    revoked.forEach((pid) => active.delete(pid));

    const legacy = await Project.find({
      assignedInCharge: oid(user.userId),
      _id: { $nin: Array.from(revoked).map(oid) },
    }).select('_id');
    legacy.forEach((p) => active.add(p._id.toString()));

    return Array.from(active).map(oid);
  }

  return [];
}

/** The MD/Owner user IDs that own a project (creator + owner, de-duplicated). */
export async function getProjectMDIds(projectId: string | mongoose.Types.ObjectId): Promise<string[]> {
  const project = await Project.findById(projectId).select('createdBy owner');
  if (!project) return [];
  const ids = new Set<string>();
  if (project.createdBy) ids.add(project.createdBy.toString());
  if (project.owner) ids.add(project.owner.toString());
  return Array.from(ids);
}

/**
 * The "company" IDs (MD user IDs) the caller belongs to.
 *   - MD → [self]
 *   - In-Charge → MDs owning their currently accessible projects
 */
export async function getCompanyIdsForUser(user: Pick<AuthUserPayload, 'userId' | 'role'>): Promise<string[]> {
  if (isMD(user.role)) return [user.userId];
  const projectIds = await getAccessibleProjectIds(user);
  if (projectIds.length === 0) return [];
  const projects = await Project.find({ _id: { $in: projectIds } }).select('createdBy owner');
  const ids = new Set<string>();
  projects.forEach((p) => {
    if (p.createdBy) ids.add(p.createdBy.toString());
    if (p.owner) ids.add(p.owner.toString());
  });
  return Array.from(ids);
}

/**
 * IDs of the Site In-Charge users that belong to an MD's company:
 * users the MD created/invited (`createdByMD`) or anyone ever assigned to one
 * of the MD's projects.
 */
export async function getCompanyInChargeIds(mdUserId: string): Promise<mongoose.Types.ObjectId[]> {
  const projectIds = await getAccessibleProjectIds({ userId: mdUserId, role: 'MD' });
  const [assignments, legacyProjects, created] = await Promise.all([
    ProjectAssignment.find({ project: { $in: projectIds } }).select('siteInCharge'),
    Project.find({ _id: { $in: projectIds }, assignedInCharge: { $exists: true, $ne: null } }).select(
      'assignedInCharge'
    ),
    User.find({ createdByMD: oid(mdUserId) }).select('_id'),
  ]);
  const ids = new Set<string>();
  assignments.forEach((a) => ids.add(a.siteInCharge.toString()));
  legacyProjects.forEach((p) => p.assignedInCharge && ids.add(p.assignedInCharge.toString()));
  created.forEach((u) => ids.add(u._id.toString()));
  return Array.from(ids).map(oid);
}

/** True when the given In-Charge belongs to the MD's company. */
export async function isInChargeInCompany(mdUserId: string, inChargeId: string): Promise<boolean> {
  const ids = await getCompanyInChargeIds(mdUserId);
  return ids.some((id) => id.toString() === String(inChargeId));
}
