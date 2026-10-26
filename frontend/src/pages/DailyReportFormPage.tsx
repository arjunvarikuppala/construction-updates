import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  Upload,
  CheckCircle2,
  Save,
  Trash2,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Input, Textarea, Select } from '../components/common/Input.js';
import { WorkItemsInput } from '../components/reports/WorkItemsInput.js';
import { LabourBreakdownInput } from '../components/reports/LabourBreakdownInput.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Project, WorkItem, LabourCountItem, SitePhoto } from '../types/index.js';
import { api } from '../api/client.js';

export const DailyReportFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditing = Boolean(editId);

  const { user, isInCharge } = useAuth();
  const { success, error: toastError } = useToast();

  const [projectId, setProjectId] = useState('');
  const [titleOfWork, setTitleOfWork] = useState('');
  const [titleError, setTitleError] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [workSummary, setWorkSummary] = useState('');
  const [workItems, setWorkItems] = useState<WorkItem[]>([
    { description: '', quantity: 0, unit: 'sq.m' },
  ]);
  const [labourList, setLabourList] = useState<LabourCountItem[]>([
    { role: 'Mason', count: 4 },
    { role: 'Helper / Unskilled', count: 8 },
  ]);
  const [equipmentDetails, setEquipmentDetails] = useState('');
  const [issuesAndDelays, setIssuesAndDelays] = useState('');
  const [nextDayPlan, setNextDayPlan] = useState('');
  const [photos, setPhotos] = useState<SitePhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-report'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  // Fetch report if in edit mode
  useQuery({
    queryKey: ['daily-report-edit', editId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; report: any }>(`/daily-reports/${editId}`);
      if (res.report) {
        const r = res.report;
        setTitleOfWork(r.titleOfWork || '');
        setProjectId(r.project?._id || r.project?.id || '');
        setWorkDate(r.workDate ? r.workDate.split('T')[0] : '');
        setWorkSummary(r.workSummary || '');
        if (r.workItems && r.workItems.length > 0) setWorkItems(r.workItems);
        if (r.labourBreakdown && r.labourBreakdown.length > 0) setLabourList(r.labourBreakdown);
        setEquipmentDetails(r.equipmentDetails || '');
        setIssuesAndDelays(r.issuesAndDelays || '');
        setNextDayPlan(r.nextDayPlan || '');
        setPhotos(r.photos || []);
      }
      return res;
    },
    enabled: isEditing,
  });

  const projects = projectsData?.projects || [];

  useEffect(() => {
    if (projects.length > 0 && !projectId) {
      setProjectId(projects[0]._id || projects[0].id!);
    }
  }, [projects, projectId]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    setIsUploading(true);
    try {
      const res = await api.post<{ success: boolean; files: Array<{ url: string; originalName: string }> }>(
        '/uploads/multiple',
        formData
      );
      if (res.success && res.files) {
        const newPhotos: SitePhoto[] = res.files.map((f) => ({
          url: f.url,
          caption: f.originalName,
          uploadedAt: new Date().toISOString(),
        }));
        setPhotos((prev) => [...prev, ...newPhotos]);
        success(`${res.files.length} site photo(s) uploaded successfully!`);
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to upload photos');
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (status: 'DRAFT' | 'SUBMITTED') => {
    if (!titleOfWork.trim()) {
      setTitleError('Title of Work is required.');
      toastError('Title of Work is required.');
      return;
    }
    if (!projectId) {
      toastError('Please select a project');
      return;
    }
    if (!workDate) {
      toastError('Please specify the work date');
      return;
    }
    if (!workSummary.trim()) {
      toastError('Work summary is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        project: projectId,
        titleOfWork: titleOfWork.trim(),
        workDate,
        workSummary: workSummary.trim(),
        workItems: workItems.filter((item) => item.description.trim().length > 0),
        labourBreakdown: labourList.filter((l) => l.count > 0),
        equipmentDetails: equipmentDetails.trim(),
        issuesAndDelays: issuesAndDelays.trim(),
        nextDayPlan: nextDayPlan.trim(),
        photos,
        status,
      };

      if (isEditing) {
        await api.put(`/daily-reports/${editId}`, payload);
        success(
          status === 'DRAFT'
            ? 'Daily report draft updated successfully!'
            : 'Daily report updated and submitted to Managing Director!'
        );
      } else {
        await api.post('/daily-reports', payload);
        success(
          status === 'DRAFT'
            ? 'Draft daily report saved safely!'
            : 'Daily report officially submitted to Managing Director!'
        );
      }

      navigate('/reports');
    } catch (err: any) {
      toastError(err.message || 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/reports')}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-navy-950">
              {isEditing ? 'Edit Daily Construction Report' : 'New Daily Construction Report'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditing
                ? 'Update work details, labour counts, and site photos.'
                : 'Submit site activities, measured items, worker counts, and photographic records.'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Form */}
      <div className="space-y-6">
        {/* Project & Date */}
        <Card>
          <CardHeader>
            <CardTitle>Project & Date Identification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Construction Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                <option value="">Select Project</option>
                {projects.map((p) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Select>

              <Input
                label="Work Date"
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                required
              />
            </div>

            <Input
              label="Title of Work"
              placeholder="E.g., Brickwork on Ground Floor, RCC Slab Casting, Electrical Wiring – First Floor..."
              value={titleOfWork}
              onChange={(e) => {
                setTitleOfWork(e.target.value);
                if (titleError) setTitleError('');
              }}
              error={titleError}
              helperText="Enter a clear, manual title for today's primary activity or milestone"
              required
            />

            <Textarea
              label="Work Summary & Progress Highlights"
              placeholder="Detailed description of primary work executed today (e.g. 4th floor slab reinforcement tied, plumbing rough-in completed, column concrete casted)..."
              rows={3}
              value={workSummary}
              onChange={(e) => setWorkSummary(e.target.value)}
              required
            />
          </CardContent>
        </Card>

        {/* Work Completed & Quantities */}
        <Card>
          <CardContent>
            <WorkItemsInput items={workItems} onChange={setWorkItems} />
          </CardContent>
        </Card>

        {/* Labour Attendance & Trades */}
        <Card>
          <CardContent>
            <LabourBreakdownInput labourList={labourList} onChange={setLabourList} />
          </CardContent>
        </Card>

        {/* Equipment & Delays */}
        <Card>
          <CardHeader>
            <CardTitle>Machinery, Issues & Tomorrow&apos;s Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              label="Machinery & Heavy Equipment Log"
              placeholder="E.g., 1x Tower crane operational (7 hrs), 1x Concrete batching mixer, 2x Needle vibrators..."
              rows={2}
              value={equipmentDetails}
              onChange={(e) => setEquipmentDetails(e.target.value)}
            />

            <Textarea
              label="Delays, Site Incidents, or Material Shortages"
              placeholder="E.g., 2 hour halt due to sudden unseasonal rain; diesel tanker delivery delayed by vendor..."
              rows={2}
              value={issuesAndDelays}
              onChange={(e) => setIssuesAndDelays(e.target.value)}
            />

            <Textarea
              label="Next-Day Construction Plan"
              placeholder="E.g., Casting M25 grade concrete on slab 4B starting 07:00 AM; stripping formwork of shear walls..."
              rows={2}
              value={nextDayPlan}
              onChange={(e) => setNextDayPlan(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Photographic Evidence Upload */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Site Photos & Videos</CardTitle>
              <p className="text-xs text-slate-500">Capture or upload site progress photos and video walkthroughs</p>
            </div>
            <label className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-navy-900 text-white text-xs font-semibold cursor-pointer hover:bg-navy-800 transition-colors">
              <Camera className="w-4 h-4 text-amber-400" />
              <span>{isUploading ? 'Uploading Media...' : 'Attach Photos / Videos'}</span>
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={handlePhotoUpload}
                disabled={isUploading}
              />
            </label>
          </CardHeader>
          <CardContent>
            {photos.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2">
                <ImageIcon className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs text-slate-500">
                  No site media attached yet. Tap &quot;Attach Photos / Videos&quot; to upload high-res images or site clips.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {photos.map((photo, idx) => {
                  const isVideo = /\.(mp4|webm|mov|mkv|avi|3gp)($|\?)/i.test(photo.url);

                  return (
                    <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 group bg-slate-900 aspect-square">
                      {isVideo ? (
                        <div className="w-full h-full flex items-center justify-center bg-black relative">
                          <video
                            src={photo.url}
                            className="w-full h-full object-cover opacity-80"
                            preload="metadata"
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-8 h-8 rounded-full bg-navy-900/80 text-amber-400 flex items-center justify-center shadow">
                              <Video className="w-4 h-4" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={photo.url}
                          alt={photo.caption || 'Site photo'}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1.5 right-1.5 p-1 rounded-full bg-navy-950/80 text-white hover:bg-rose-600 transition-colors z-10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      {photo.caption && (
                        <div className="absolute inset-x-0 bottom-0 bg-navy-950/70 p-1 text-[10px] text-white truncate text-center z-10">
                          {photo.caption}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-3">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => handleSubmit('DRAFT')}
            disabled={isSubmitting}
            leftIcon={<Save className="w-4 h-4 text-slate-500" />}
          >
            Save as Draft
          </Button>

          <Button
            type="button"
            variant="amber"
            className="w-full sm:w-auto font-bold"
            onClick={() => handleSubmit('SUBMITTED')}
            isLoading={isSubmitting}
            leftIcon={<CheckCircle2 className="w-4 h-4 text-navy-950" />}
          >
            {isEditing ? 'Save & Update Report' : 'Submit Official Daily Report'}
          </Button>
        </div>
      </div>
    </div>
  );
};
