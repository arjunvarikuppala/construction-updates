/**
 * Project material log: stock on site, every change to it, and adding stock.
 * Open to anyone with access to the project (the MD, or an assigned in-charge).
 *
 *   GET    /projects/:id/materials                 stock per material
 *   GET    /projects/:id/materials/log?materialId= every change, newest first, with running balance
 *   POST   /projects/:id/materials/entries         add stock / record use / correct the count
 *   DELETE /projects/:id/materials/entries/:entryId remove a hand-entered entry (its author or the MD)
 *   PATCH  /projects/:id/materials/:materialId     set the low-stock level (MD)
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { ProjectMaterial, MaterialLogEntry } from '../models/MaterialStock.js';
import { logAudit } from '../services/auditService.js';
import {
  MATERIAL_LOG_START_DAY,
  cleanMaterialName,
  cleanUnit,
  findOrCreateMaterial,
  getProjectStock,
  getMaterialBalance,
  entryDateFor,
  round3,
} from '../services/materialStockService.js';

const LOG_LIMIT = 500;

async function projectFor(req: AuthenticatedRequest, res: Response) {
  const access = await verifyUserProjectAccess(String(req.params.id), req.user!.userId, req.user!.role);
  if (!access.allowed || !access.project) {
    res.status(404).json({ success: false, message: 'Project not found' });
    return null;
  }
  return access.project;
}

const text = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : undefined;
};

export async function listMaterials(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const project = await projectFor(req, res);
    if (!project) return;
    const materials = await getProjectStock(project._id as mongoose.Types.ObjectId);
    res.json({ success: true, startDate: MATERIAL_LOG_START_DAY, materials });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to load material stock', error: error.message });
  }
}

export async function getMaterialLog(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const project = await projectFor(req, res);
    if (!project) return;
    const filter: any = { project: project._id };
    if (typeof req.query.materialId === 'string' && mongoose.isValidObjectId(req.query.materialId)) {
      filter.material = new mongoose.Types.ObjectId(req.query.materialId);
    }

    const [entries, materials] = await Promise.all([
      MaterialLogEntry.find(filter).sort({ date: 1, createdAt: 1, _id: 1 }).populate('createdBy', 'name role').lean(),
      ProjectMaterial.find({ project: project._id }).select('name unit').lean(),
    ]);
    const matById = new Map(materials.map((m: any) => [String(m._id), m]));
    const running = new Map<string, number>();

    const rows = entries.map((e: any) => {
      const mid = String(e.material);
      const balance = round3((running.get(mid) || 0) + e.change);
      running.set(mid, balance);
      const m: any = matById.get(mid) || {};
      const by = e.createdBy && typeof e.createdBy === 'object' ? e.createdBy : null;
      return {
        _id: String(e._id),
        materialId: mid,
        materialName: m.name || 'Material',
        unit: m.unit || '',
        type: e.type,
        change: e.change,
        balanceAfter: balance,
        date: new Date(e.date).toISOString(),
        source: e.source,
        reportId: e.report ? String(e.report) : null,
        reportTitle: e.reportTitle || null,
        supplier: e.supplier || null,
        billNo: e.billNo || null,
        rate: e.rate ?? null,
        note: e.note || null,
        createdBy: by ? { _id: String(by._id), name: by.name, role: by.role } : null,
        createdAt: new Date(e.createdAt).toISOString(),
      };
    });

    rows.reverse();
    res.json({ success: true, total: rows.length, entries: rows.slice(0, LOG_LIMIT) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to load the material log', error: error.message });
  }
}

export async function addMaterialEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const project = await projectFor(req, res);
    if (!project) return;
    const b = req.body || {};

    const type = b.type === 'OUT' || b.type === 'ADJUST' ? b.type : b.type === 'IN' || b.type === undefined ? 'IN' : null;
    if (!type) {
      res.status(400).json({ success: false, message: 'Choose stock added, used, or corrected count' });
      return;
    }

    const quantity = Number(b.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'ADJUST' && quantity === 0)) {
      res.status(400).json({ success: false, message: type === 'ADJUST' ? 'Enter the counted stock' : 'Enter a quantity above zero' });
      return;
    }
    if (quantity > 1e9) {
      res.status(400).json({ success: false, message: 'That quantity is too large' });
      return;
    }

    const date = entryDateFor(b.date);
    if (!date) {
      res.status(400).json({ success: false, message: 'Enter a valid date that is not in the future' });
      return;
    }

    let material;
    if (b.materialId) {
      if (!mongoose.isValidObjectId(b.materialId)) {
        res.status(400).json({ success: false, message: 'Material not found' });
        return;
      }
      material = await ProjectMaterial.findOne({ _id: b.materialId, project: project._id });
      if (!material) {
        res.status(400).json({ success: false, message: 'Material not found on this project' });
        return;
      }
    } else {
      const name = cleanMaterialName(b.name);
      const unit = cleanUnit(b.unit);
      if (!name || !unit) {
        res.status(400).json({ success: false, message: 'Enter the material name and unit' });
        return;
      }
      material = await findOrCreateMaterial(project._id as mongoose.Types.ObjectId, name, unit, req.user!.userId);
    }

    let change = round3(type === 'OUT' ? -quantity : quantity);
    if (type === 'ADJUST') {
      change = round3(quantity - (await getMaterialBalance(material._id as mongoose.Types.ObjectId)));
      if (change === 0) {
        res.status(400).json({ success: false, message: `Stock already shows ${quantity} ${material.unit}` });
        return;
      }
    }

    const rate = Number(b.rate);
    const entry = await MaterialLogEntry.create({
      project: project._id,
      material: material._id,
      type,
      change,
      date,
      source: 'MANUAL',
      supplier: type === 'IN' ? text(b.supplier, 150) : undefined,
      billNo: type === 'IN' ? text(b.billNo, 60) : undefined,
      rate: type === 'IN' && Number.isFinite(rate) && rate > 0 ? rate : undefined,
      note: text(b.note, 300),
      createdBy: req.user!.userId,
    });

    await logAudit('MATERIAL_STOCK_ENTRY', req.user!.userId, 'MATERIAL', material._id as mongoose.Types.ObjectId, {
      project: project._id,
      material: material.name,
      type,
      change,
    });

    const balance = await getMaterialBalance(material._id as mongoose.Types.ObjectId);
    res.status(201).json({ success: true, entry, material: { _id: String(material._id), name: material.name, unit: material.unit, balance } });
  } catch (error: any) {
    if (error?.name === 'ValidationError') {
      res.status(400).json({ success: false, message: 'Some fields are invalid. Check them and try again.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to save the stock entry', error: error.message });
  }
}

export async function deleteMaterialEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const project = await projectFor(req, res);
    if (!project) return;
    const { entryId } = req.params;
    const entry = mongoose.isValidObjectId(entryId) ? await MaterialLogEntry.findOne({ _id: entryId, project: project._id }) : null;
    if (!entry) {
      res.status(404).json({ success: false, message: 'Entry not found' });
      return;
    }
    if (entry.source === 'REPORT') {
      res.status(400).json({ success: false, message: 'This entry comes from a daily report. Edit the report to change it.' });
      return;
    }
    if (!isMD(req.user!.role) && String(entry.createdBy) !== req.user!.userId) {
      res.status(403).json({ success: false, message: 'Only the person who added this entry, or the MD, can remove it.' });
      return;
    }
    await entry.deleteOne();
    await logAudit('MATERIAL_STOCK_ENTRY_DELETED', req.user!.userId, 'MATERIAL', entry.material, {
      project: project._id,
      type: entry.type,
      change: entry.change,
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to remove the entry', error: error.message });
  }
}

export async function updateMaterial(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const project = await projectFor(req, res);
    if (!project) return;
    const { materialId } = req.params;
    const material = mongoose.isValidObjectId(materialId) ? await ProjectMaterial.findOne({ _id: materialId, project: project._id }) : null;
    if (!material) {
      res.status(404).json({ success: false, message: 'Material not found' });
      return;
    }
    const raw = req.body?.lowStockLevel;
    if (raw === null || raw === '') {
      material.lowStockLevel = undefined;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ success: false, message: 'Enter a low-stock level of zero or more' });
        return;
      }
      material.lowStockLevel = round3(n);
    }
    await material.save();
    res.json({ success: true, material });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update the material', error: error.message });
  }
}
