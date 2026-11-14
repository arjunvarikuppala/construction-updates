import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localDateString } from '../utils/dates.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Save, History, WifiOff, RotateCcw, X, AlertCircle, Copy } from 'lucide-react';
import { Card, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Input, Textarea, Select } from '../components/common/Input.js';
import { WorkItemsInput, emptyWorkItem } from '../components/reports/WorkItemsInput.js';
import { LabourBreakdownInput } from '../components/reports/LabourBreakdownInput.js';
import { MaterialsInput, MachineryInput, ReportStockInfo } from '../components/reports/ResourceRowsInput.js';
import { MaterialStockResponse, materialKey } from '../utils/materialStock.js';
import { ReportExpensesInput } from '../components/reports/ReportExpensesInput.js';
import { MediaUploader } from '../components/reports/MediaUploader.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { useOffline } from '../hooks/useOffline.js';
import { localDraftKey, readLocalDraft, clearLocalDraft, useLocalDraftWriter, StoredDraft } from '../hooks/useLocalDraft.js';
import {
  Project,
  WorkItem,
  LabourCountItem,
  SitePhoto,
  MaterialItem,
  MachineryItem,
  ReportExpenseDraft,
  ReportShift,
  DailyReport,
} from '../types/index.js';
import { api, ApiError } from '../api/client.js';
import { SHIFT_OPTIONS, materialCost, machineCost, labourCost } from '../utils/reportOptions.js';
import { ReportCostSummary, ReportCostTotals } from '../components/reports/ReportCostSummary.js';
import { gstFromSaved, gstDraftToPayload, gstDraftProblems, gstDraftTaxRupees } from '../utils/gst.js';
import { newRequestId } from '../utils/upload.js';
import { paiseToRupees } from '../utils/currency.js';

interface FormState {
  projectId: string;
  titleOfWork: string;
  workDate: string;
  shift: ReportShift | '';
  workLocation: string;
  workSummary: string;
  overallProgressPercent: string;
  workItems: WorkItem[];
  labourList: LabourCountItem[];
  materials: MaterialItem[];
  machinery: MachineryItem[];
  expenses: ReportExpenseDraft[];
  issuesAndDelays: string;
  nextDayPlan: string;
  remarks: string;
  photos: SitePhoto[];
  clientRequestId: string;
}

const localToday = () => localDateString();

const initialState = (): FormState => ({
  projectId: '',
  titleOfWork: '',
  workDate: localToday(),
  shift: 'DAY',
  workLocation: '',
  workSummary: '',
  overallProgressPercent: '',
  workItems: [emptyWorkItem()],
  labourList: [],
  materials: [],
  machinery: [],
  expenses: [],
  issuesAndDelays: '',
  nextDayPlan: '',
  remarks: '',
  photos: [],
  clientRequestId: newRequestId(),
});

function fromReport(r: DailyReport): FormState {
  return {
    projectId: r.project?._id || (r.project as any)?.id || '',
    titleOfWork: r.titleOfWork || '',
    workDate: r.workDate ? r.workDate.split('T')[0] : localToday(),
    shift: r.shift || '',
    workLocation: r.workLocation || '',
    workSummary: r.workSummary || '',
    overallProgressPercent: r.overallProgressPercent === undefined || r.overallProgressPercent === null ? '' : String(r.overallProgressPercent),
    workItems: r.workItems?.length ? r.workItems : [emptyWorkItem(r.workLocation)],
    labourList: r.labourBreakdown || [],
    materials: r.materials || [],
    machinery: r.machinery || [],
    expenses: (r.expenses || []).map((e) => ({
      _id: e._id,
      category: e.category,
      description: e.description,
      amount: String(paiseToRupees(e.amount)),
      vendor: e.vendor === 'Not specified' ? '' : e.vendor,
      receiptUrl: e.receiptUrl,
      status: e.status,
      gst: gstFromSaved(e.gst),
    })),
    issuesAndDelays: r.issuesAndDelays || '',
    nextDayPlan: r.nextDayPlan || '',
    remarks: r.remarks || '',
    photos: r.photos || [],
    clientRequestId: newRequestId(),
  };
}

const SectionCard: React.FC<{ id: string; title: string; subtitle?: string; children: React.ReactNode }> = ({ id, title, subtitle, children }) => (
  <Card>
    <CardContent className="space-y-4">
      {title && (
        <div id={id} className="scroll-mt-24">
          <h2 className="text-base font-semibold text-navy-950">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      )}
      {children}
    </CardContent>
  </Card>
);

export const DailyReportFormPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditing = Boolean(editId);

  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const isOffline = useOffline();

  const [form, setForm] = useState<FormState>(initialState);
  const [loaded, setLoaded] = useState(!isEditing);
  const [serverStatus, setServerStatus] = useState<'DRAFT' | 'SUBMITTED' | null>(null);
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<StoredDraft<FormState> | null>(null);

  const draftKey = localDraftKey(user?.id || (user as any)?._id, editId);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key as string]) setFieldErrors((e) => ({ ...e, [key as string]: '' }));
  };
  const setFn =
    <K extends keyof FormState>(key: K) =>
    (next: FormState[K] | ((prev: FormState[K]) => FormState[K])) =>
      setForm((f) => ({ ...f, [key]: typeof next === 'function' ? (next as any)(f[key]) : next }));

  // ---- Data -----------------------------------------------------------------
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-for-report'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });
  const projects = useMemo(
    () => (projectsData?.projects || []).filter((p) => p.status !== 'COMPLETED' || (p._id || p.id) === form.projectId),
    [projectsData, form.projectId]
  );

  const editQuery = useQuery({
    queryKey: ['daily-report-edit', editId],
    queryFn: () => api.get<{ success: boolean; report: DailyReport }>(`/daily-reports/${editId}`),
    enabled: isEditing,
    refetchOnWindowFocus: false,
  });

  // Load server copy once, then offer any newer device-local copy
  useEffect(() => {
    if (!isEditing || !editQuery.data?.report || loaded) return;
    const r = editQuery.data.report;
    setForm(fromReport(r));
    setServerStatus(r.status);
    setServerUpdatedAt(r.updatedAt);
    const local = readLocalDraft<FormState>(draftKey);
    if (local && local.savedAt > new Date(r.updatedAt).getTime()) setPendingRestore(local);
    setLoaded(true);
  }, [isEditing, editQuery.data, loaded, draftKey]);

  useEffect(() => {
    if (isEditing) return;
    const local = readLocalDraft<FormState>(draftKey);
    if (local) setPendingRestore(local);
  }, [isEditing, draftKey]);

  // Site stock for the chosen project, shown beside each material used
  const stockQuery = useQuery({
    queryKey: ['material-stock', form.projectId],
    queryFn: () => api.get<MaterialStockResponse>(`/projects/${form.projectId}/materials`),
    enabled: Boolean(form.projectId) && !isOffline,
    staleTime: 30000,
  });
  const stockInfo = useMemo<ReportStockInfo | undefined>(() => {
    const data = stockQuery.data;
    if (!data) return undefined;
    // Editing a submitted report: its own quantities are already off the stock, so add them back
    const credit: Record<string, number> = {};
    const saved = editQuery.data?.report;
    const savedProject = saved && (saved.project?._id || (saved.project as any)?.id || saved.project);
    if (saved && saved.status === 'SUBMITTED' && String(savedProject) === form.projectId && saved.workDate && saved.workDate.slice(0, 10) >= data.startDate) {
      for (const m of saved.materials || []) {
        const k = materialKey(m.name, m.unit);
        credit[k] = (credit[k] || 0) + (m.quantity || 0) - (m.received || 0);
      }
    }
    return { materials: data.materials, credit, counts: form.workDate >= data.startDate, startDate: data.startDate };
  }, [stockQuery.data, editQuery.data, form.projectId, form.workDate]);

  useEffect(() => {
    if (!form.projectId && projects.length > 0 && !isEditing) {
      setForm((f) => ({ ...f, projectId: projects[0]._id || projects[0].id! }));
    }
  }, [projects, form.projectId, isEditing]);

  // Autosave locally only after the user has interacted (not while a restore prompt is open)
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (loaded) setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  useLocalDraftWriter(draftKey, form, loaded && dirty && !pendingRestore && serverStatus !== 'SUBMITTED', serverUpdatedAt);

  // "Copy from my last report" — avoids retyping the same crew & machines every day
  const copyFromLast = async () => {
    if (!form.projectId) return;
    try {
      const res = await api.get<{ reports: DailyReport[] }>(`/daily-reports?projectId=${form.projectId}&status=SUBMITTED`);
      const mine = (res.reports || []).find((r) => (r.submittedBy?._id || (r.submittedBy as any)) === (user?.id || (user as any)?._id));
      const last = mine || res.reports?.[0];
      if (!last) {
        toastError('No earlier submitted report for this project yet.');
        return;
      }
      setForm((f) => ({
        ...f,
        labourList: last.labourBreakdown?.length ? last.labourBreakdown : f.labourList,
        machinery: last.machinery?.length ? last.machinery : f.machinery,
        workLocation: f.workLocation || last.workLocation || '',
        shift: f.shift || last.shift || 'DAY',
      }));
      success(`Copied labour and machinery from ${new Date(last.workDate).toLocaleDateString('en-IN')}. Adjust today's numbers.`);
    } catch (e: any) {
      toastError(e.message || 'Could not load the previous report');
    }
  };

  // ---- Validation -------------------------------------------------------------
  const validate = (status: 'DRAFT' | 'SUBMITTED'): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!form.projectId) errs.projectId = 'Select the project / site';
    if (!form.titleOfWork.trim()) errs.titleOfWork = 'Enter a title for today’s work';
    if (!form.workDate) errs.workDate = 'Select the report date';
    else if (form.workDate > localToday()) errs.workDate = 'Date cannot be in the future';
    if (status === 'SUBMITTED') {
      // No single section is mandatory — the report just needs something in any one of them.
      const hasContent =
        form.workSummary.trim() ||
        form.workItems.some((w) => w.description.trim()) ||
        form.labourList.some((l) => l.count > 0) ||
        form.materials.some((m) => m.name.trim()) ||
        form.machinery.some((m) => m.name.trim()) ||
        form.expenses.some((e) => e.description.trim() || e.amount) ||
        form.photos.length > 0;
      if (!hasContent) {
        errs.workItems = 'Add at least one entry — a work item, labour, material, machinery, expense, photo or description';
      }
      const p = form.overallProgressPercent;
      if (p !== '' && (Number(p) < 0 || Number(p) > 100)) errs.overallProgressPercent = 'Enter 0–100';
      form.expenses.forEach((e, i) => {
        const amt = parseFloat(e.amount);
        if ((e.description.trim() || e.amount) && (!e.description.trim() || !(amt >= 1))) {
          errs.expenses = `Expense ${i + 1}: add a description and an amount of at least ₹1`;
        }
        if (e.gst?.isGstBill && (!e.status || e.status === 'DRAFT')) {
          const problems = gstDraftProblems(e.gst, !!e.receiptUrl);
          if (problems.length) errs.expenses = `Expense ${i + 1} (GST bill): ${problems[0]}`;
        }
      });
    }
    return errs;
  };

  const handleSubmit = async (status: 'DRAFT' | 'SUBMITTED') => {
    if (submittingRef.current) return; // guard against double taps
    if (mediaBusy || receiptBusy) {
      toastError('Please wait for uploads to finish.');
      return;
    }
    const errs = validate(status);
    setFieldErrors(errs);
    const firstKey = Object.keys(errs)[0];
    if (firstKey) {
      toastError(errs[firstKey]);
      document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (isOffline) {
      toastError('You are offline. Your report is saved on this device — submit when you are back online.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const payload = {
        project: form.projectId,
        titleOfWork: form.titleOfWork.trim(),
        workDate: form.workDate,
        shift: form.shift || undefined,
        workLocation: form.workLocation.trim(),
        workSummary: form.workSummary.trim(),
        overallProgressPercent: form.overallProgressPercent === '' ? null : Number(form.overallProgressPercent),
        workItems: form.workItems.filter((w) => w.description.trim()),
        labourBreakdown: form.labourList.filter((l) => l.count > 0),
        materials: form.materials.filter((m) => m.name.trim()),
        machinery: form.machinery.filter((m) => m.name.trim()),
        expenses: form.expenses
          .filter((e) => e.description.trim() || e.amount)
          .map((e) => ({
            _id: e._id,
            category: e.category,
            description: e.description.trim(),
            amount: e.amount,
            vendor: e.vendor.trim(),
            receiptUrl: e.receiptUrl,
            gst: gstDraftToPayload(e.gst),
          })),
        equipmentDetails: form.machinery
          .filter((m) => m.name.trim())
          .map((m) => `${m.quantity}× ${m.name}${m.hoursUsed ? ` (${m.hoursUsed} hrs)` : ''}`)
          .join(', '),
        issuesAndDelays: form.issuesAndDelays.trim(),
        nextDayPlan: form.nextDayPlan.trim(),
        remarks: form.remarks.trim(),
        photos: form.photos,
        status,
        clientRequestId: form.clientRequestId,
      };

      let savedId = editId;
      if (isEditing) {
        await api.put(`/daily-reports/${editId}`, payload);
      } else {
        const res = await api.post<{ report: { _id: string }; duplicate?: boolean }>('/daily-reports', payload);
        savedId = res.report?._id;
      }
      clearLocalDraft(draftKey);
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['material-stock'] });
      queryClient.invalidateQueries({ queryKey: ['material-log'] });
      queryClient.invalidateQueries({ queryKey: ['in-charge-dashboard'] });
      success(status === 'DRAFT' ? 'Draft saved. You can finish it later.' : 'Report submitted to the Managing Director.');
      if (status === 'DRAFT' && !isEditing && savedId) navigate(`/reports/new?edit=${savedId}`, { replace: true });
      else navigate(savedId && status === 'SUBMITTED' ? `/reports/${savedId}` : '/reports');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.data?.existingReportId) {
        toastError(err.message);
      } else if (err instanceof ApiError && Array.isArray(err.data?.errors)) {
        toastError(err.data.errors.slice(0, 3).join(' • '));
      } else {
        toastError(err?.message || 'Could not save the report. Your work is kept on this device.');
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const uploadsBusy = mediaBusy || receiptBusy;
  const isSubmittedReport = serverStatus === 'SUBMITTED';

  if (isEditing && editQuery.isError) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <p className="text-sm text-slate-700">This report could not be opened. It may have been removed or you may not have access.</p>
        <Button variant="outline" onClick={() => navigate('/reports')}>Back to reports</Button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="max-w-3xl mx-auto space-y-4" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-2xl bg-slate-200/70 animate-pulse" />
        ))}
      </div>
    );
  }

  const err = (k: string) => fieldErrors[k];


  const costTotals: ReportCostTotals = {
    work: form.workItems.reduce((sum, i) => sum + (Number(i.budget) || 0), 0),
    labour: form.labourList.reduce((sum, l) => sum + labourCost(l), 0),
    materials: form.materials.reduce((sum, m) => sum + materialCost(m), 0),
    machinery: form.machinery.reduce((sum, m) => sum + machineCost(m), 0),
    expenses: form.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
    gst: form.expenses.reduce((sum, e) => sum + (e.gst?.isGstBill ? gstDraftTaxRupees(e.gst) : 0), 0),
  };

  return (
    <div className="space-y-4 sm:space-y-5 max-w-3xl mx-auto pb-4 min-w-0">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => navigate('/reports')}
          aria-label="Back to daily reports"
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 leading-tight">
            {isSubmittedReport ? 'Edit submitted report' : isEditing ? 'Continue draft report' : 'New daily site report'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isSubmittedReport
              ? 'Changes create a new revision; the MD is notified.'
              : 'Saved on this device as you type. Submit when the day’s entries are complete.'}
          </p>
        </div>
      </div>

      {isOffline && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-sm" role="status">
          <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
          <span>You are offline. Keep filling in the report — it is saved on this phone. Photo uploads and submission need a connection.</span>
        </div>
      )}

      {pendingRestore && (
        <div className="p-3 rounded-xl bg-navy-50 border border-navy-200 text-navy-950 text-sm space-y-2" role="alert">
          <p className="flex items-start gap-2">
            <History className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Unsent changes from {new Date(pendingRestore.savedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} were found on this
              device.
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              leftIcon={<RotateCcw className="w-4 h-4" />}
              onClick={() => {
                setForm({ ...pendingRestore.data, clientRequestId: pendingRestore.data.clientRequestId || newRequestId() });
                setPendingRestore(null);
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<X className="w-4 h-4" />}
              onClick={() => {
                clearLocalDraft(draftKey);
                setPendingRestore(null);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* 1. Site & date */}
      <SectionCard id="sec-site" title="Site & date">
        <div id="field-projectId">
          <Select
            label="Project / site"
            value={form.projectId}
            onChange={(e) => set('projectId', e.target.value)}
            error={err('projectId')}
            disabled={isEditing || projectsLoading}
            required
          >
            <option value="">{projectsLoading ? 'Loading projects…' : projects.length ? 'Select project' : 'No assigned projects'}</option>
            {projects.map((p) => (
              <option key={p._id || p.id} value={p._id || p.id}>
                {p.code} – {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div id="field-workDate">
            <Input label="Date" type="date" max={localToday()} value={form.workDate} onChange={(e) => set('workDate', e.target.value)} error={err('workDate')} required />
          </div>
          <Select label="Shift" value={form.shift} onChange={(e) => set('shift', e.target.value as ReportShift)}>
            <option value="">Not specified</option>
            {SHIFT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div id="field-titleOfWork">
          <Input
            label="Title of work"
            placeholder="e.g. 2nd floor slab casting – Block A"
            value={form.titleOfWork}
            maxLength={200}
            onChange={(e) => set('titleOfWork', e.target.value)}
            error={err('titleOfWork')}
            required
          />
        </div>
        <Input
          label="Work location"
          placeholder="Floor / block / section, e.g. Tower B – 4th floor"
          value={form.workLocation}
          maxLength={200}
          onChange={(e) => set('workLocation', e.target.value)}
        />
      </SectionCard>

      {/* 2. Work done */}
      <SectionCard id="sec-work" title="Work completed today">
        <div id="field-workSummary">
          <Textarea
            label="Detailed description"
            rows={4}
            maxLength={2000}
            value={form.workSummary}
            onChange={(e) => set('workSummary', e.target.value)}
            error={err('workSummary')}
          />
        </div>
        <div id="field-workItems">
          <WorkItemsInput
            items={form.workItems}
            onChange={(v) => set('workItems', v)}
            defaultLocation={form.workLocation}
            machineOptions={form.machinery
              .filter((m) => m.name.trim())
              .map((m) => `${m.model || m.name}${m.regNo ? ` (${m.regNo})` : ''}`)}
          />
          {err('workItems') && <p className="mt-1 text-xs text-rose-600 font-semibold">{err('workItems')}</p>}
        </div>
      </SectionCard>

      {/* 3. Labour */}
      <SectionCard id="sec-labour" title="">
        <div className="flex justify-end -mb-2">
          <button type="button" onClick={copyFromLast} className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-800 hover:text-amber-700 min-h-[36px]">
            <Copy className="w-3.5 h-3.5" /> Copy crew &amp; machines from last report
          </button>
        </div>
        <LabourBreakdownInput labourList={form.labourList} onChange={(v) => set('labourList', v)} />
      </SectionCard>

      {/* 4. Materials & machinery */}
      <SectionCard id="sec-materials" title="">
        <MaterialsInput items={form.materials} onChange={(v) => set('materials', v)} stock={stockInfo} />
        <div className="border-t border-slate-100 pt-4">
          <MachineryInput items={form.machinery} onChange={(v) => set('machinery', v)} />
        </div>
      </SectionCard>

      {/* 5. Expenses */}
      <SectionCard id="sec-expenses" title="">
        <div id="field-expenses">
          <ReportExpensesInput expenses={form.expenses} onChange={setFn('expenses')} onBusyChange={setReceiptBusy} />
          {err('expenses') && <p className="mt-1 text-xs text-rose-600 font-semibold">{err('expenses')}</p>}
        </div>
      </SectionCard>

      {/* 6. Photos */}
      <SectionCard id="sec-photos" title="Site photos & videos" subtitle="Capture progress so the MD can inspect the work remotely.">
        <MediaUploader photos={form.photos} onChange={setFn('photos')} onBusyChange={setMediaBusy} />
      </SectionCard>

      {/* 7. Issues & plan */}
      <SectionCard id="sec-issues" title="Issues, plan & remarks">
        <Textarea
          label="Issues & delays"
          placeholder="e.g. Pump arrived 1 hour late; sand delivery short by 2 trips."
          rows={3}
          maxLength={1000}
          value={form.issuesAndDelays}
          onChange={(e) => set('issuesAndDelays', e.target.value)}
        />
        <Textarea
          label="Plan for tomorrow"
          placeholder="e.g. De-shuttering columns C1–C8; start brickwork on 3rd floor."
          rows={3}
          maxLength={1000}
          value={form.nextDayPlan}
          onChange={(e) => set('nextDayPlan', e.target.value)}
        />
        <Textarea label="Remarks" placeholder="Anything else the MD should know" rows={2} maxLength={1000} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
      </SectionCard>

      {/* Grand total of every section */}
      <ReportCostSummary totals={costTotals} />

      {/* Actions — sticky above the mobile bottom nav */}
      <div className="sticky -bottom-7 md:bottom-4 z-20">
        <div className="flex flex-wrap gap-2.5 p-2.5 rounded-2xl bg-white/95 backdrop-blur border border-slate-200 shadow-lg">
          {!isSubmittedReport && (
            <Button
              type="button"
              variant="outline"
              className="flex-1 min-w-[120px] whitespace-nowrap"
              size="lg"
              onClick={() => handleSubmit('DRAFT')}
              disabled={isSubmitting || uploadsBusy}
              leftIcon={<Save className="w-4 h-4 text-slate-500" />}
            >
              Save draft
            </Button>
          )}
          <Button
            type="button"
            variant="amber"
            size="lg"
            className="flex-[1.4] min-w-[140px] font-bold whitespace-nowrap"
            onClick={() => handleSubmit('SUBMITTED')}
            isLoading={isSubmitting}
            disabled={isSubmitting || uploadsBusy}
            leftIcon={<CheckCircle2 className="w-4 h-4 text-navy-950" />}
          >
            {uploadsBusy ? 'Uploading…' : isSubmittedReport ? 'Save changes' : 'Submit report'}
          </Button>
        </div>
      </div>
    </div>
  );
};
