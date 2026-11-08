/**
 * One-off, idempotent backfill for the company-scoping fields added in the
 * security hardening release. Safe to run multiple times; it only fills
 * fields that are currently missing and never deletes or rewrites data.
 *
 *   npm run migrate:tenant            # dry run (prints what would change)
 *   npm run migrate:tenant -- --apply # writes changes
 *
 * - Beneficiary.company  ← MD owning the project of a payment that used it,
 *                          else the creator when the creator is an MD.
 * - User.createdByMD     ← invitation.invitedBy, else the MD who first assigned
 *                          the In-Charge to one of their projects.
 */
import '../config/env.js';
import mongoose from 'mongoose';
import { Beneficiary } from '../models/Beneficiary.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { Project } from '../models/Project.js';
import { User } from '../models/User.js';
import { Invitation } from '../models/Invitation.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error('MONGODB_URI is required to run the migration.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  // ---- Beneficiaries ------------------------------------------------------
  const orphanBeneficiaries = await Beneficiary.find({ company: { $exists: false } });
  let benFixed = 0;
  for (const b of orphanBeneficiaries) {
    let company: mongoose.Types.ObjectId | undefined;
    const payment = await PaymentRequest.findOne({ beneficiary: b._id }).select('project');
    if (payment) {
      const project = await Project.findById(payment.project).select('owner createdBy');
      company = (project?.owner || project?.createdBy) as mongoose.Types.ObjectId | undefined;
    }
    if (!company) {
      const creator = await User.findById(b.createdBy).select('role');
      if (creator && (creator.role === 'MD' || creator.role === 'OWNER')) company = creator._id as mongoose.Types.ObjectId;
    }
    if (company) {
      benFixed++;
      console.log(`Beneficiary ${b._id} (${b.name}) → company ${company}`);
      if (APPLY) await Beneficiary.updateOne({ _id: b._id, company: { $exists: false } }, { $set: { company } });
    } else {
      console.log(`Beneficiary ${b._id} (${b.name}) → left unscoped (no linked payment / non-MD creator)`);
    }
  }

  // ---- In-Charge users ----------------------------------------------------
  const inCharges = await User.find({ role: { $in: ['SITE_INCHARGE', 'IN_CHARGE'] }, createdByMD: { $exists: false } });
  let userFixed = 0;
  for (const u of inCharges) {
    let md: mongoose.Types.ObjectId | undefined;
    const inv = await Invitation.findOne({ email: u.email, status: 'ACCEPTED' }).select('invitedBy');
    if (inv?.invitedBy) md = inv.invitedBy as mongoose.Types.ObjectId;
    if (!md) {
      const firstAssignment = await ProjectAssignment.findOne({ siteInCharge: u._id }).sort({ createdAt: 1 }).select('project');
      if (firstAssignment) {
        const project = await Project.findById(firstAssignment.project).select('owner createdBy');
        md = (project?.owner || project?.createdBy) as mongoose.Types.ObjectId | undefined;
      }
    }
    if (md) {
      userFixed++;
      console.log(`In-Charge ${u.email} → createdByMD ${md}`);
      if (APPLY) await User.updateOne({ _id: u._id, createdByMD: { $exists: false } }, { $set: { createdByMD: md } });
    }
  }

  console.log(
    `\nBeneficiaries: ${benFixed}/${orphanBeneficiaries.length} scoped. In-Charges: ${userFixed}/${inCharges.length} linked.` +
      (APPLY ? '' : '\nDry run only — re-run with --apply to write changes.')
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
