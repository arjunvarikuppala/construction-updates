import React, { useState, useEffect } from 'react';
import { localDateString } from '../../utils/dates.js';
import { Building2, MapPin, Search, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input, Textarea, Select } from '../common/Input.js';
import { Project, ProjectStatus, User } from '../../types/index.js';
import { paiseToRupees } from '../../utils/currency.js';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project?: Project | null;
  onSuccess?: () => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  project,
  onSuccess,
}) => {
  const isEditing = Boolean(project);
  const { user, isOwner, logout } = useAuth();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [budgetRupees, setBudgetRupees] = useState('');
  const [assignedInCharge, setAssignedInCharge] = useState('');
  const [startDate, setStartDate] = useState('');
  const [expectedCompletionDate, setExpectedCompletionDate] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('IN_PROGRESS');

  const [inChargeUsers, setInChargeUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifyingLocation, setIsVerifyingLocation] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<string | null>(null);
  const [locationCandidates, setLocationCandidates] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Fetch in-charge candidates
      api.get<{ users: User[] }>('/users/in-charge').then((res) => {
        if (res.users) setInChargeUsers(res.users);
      }).catch(console.error);

      if (project) {
        setName(project.name);
        setCode(project.code);
        setLocation(project.location || '');
        setAddress(project.address || '');
        setDescription(project.description || '');
        setBudgetRupees(project.budget ? String(paiseToRupees(project.budget)) : '');
        setAssignedInCharge(project.assignedInCharge?._id || project.assignedInCharge?.id || '');
        setStartDate(project.startDate ? project.startDate.split('T')[0] : '');
        setExpectedCompletionDate(project.expectedCompletionDate ? project.expectedCompletionDate.split('T')[0] : '');
        setStatus(project.status || 'IN_PROGRESS');
      } else {
        setName('');
        setCode('');
        setLocation('');
        setAddress('');
        setDescription('');
        setBudgetRupees('');
        setAssignedInCharge('');
        setStartDate(localDateString());
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        setExpectedCompletionDate(localDateString(nextYear));
        setStatus('IN_PROGRESS');
      }
      setLocationFeedback(null);
      setLocationCandidates([]);
      setError('');
    }
  }, [isOpen, project]);

  // Handle Location Verification & Ambiguity Resolution
  const handleVerifyLocation = async () => {
    const query = [location, address].filter(Boolean).join(' ').trim();
    if (!query) {
      setLocationFeedback('Please enter a construction site location or city to verify.');
      return;
    }

    setIsVerifyingLocation(true);
    setLocationFeedback(null);
    setLocationCandidates([]);

    try {
      const res = await api.post<{ success: boolean; results: any[] }>('/projects/geocode', { query });
      if (res.results && res.results.length > 0) {
        const top = res.results[0];
        setLocation(top.name);
        setLocationFeedback(`✓ Verified Site Location: ${top.name}`);
        if (res.results.length > 1) {
          setLocationCandidates(res.results.slice(1, 4));
        }
      } else {
        setLocationFeedback('Location could not be automatically resolved. Please specify the city or state (e.g. "Gachibowli, Hyderabad, Telangana, India").');
      }
    } catch (err: any) {
      setLocationFeedback(`Location check failed: ${err.message || 'Network error'}`);
    } finally {
      setIsVerifyingLocation(false);
    }
  };

  const handleSelectCandidate = (candidate: any) => {
    setLocation(candidate.name);
    setLocationFeedback(`✓ Selected: ${candidate.name}`);
    setLocationCandidates([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim() || (!location.trim() && !address.trim())) {
      setError('Project name, unique project code, and construction site location are required.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const effectiveLocation = location.trim() || address.trim();

      const payload: any = {
        name: name.trim(),
        code: code.toUpperCase().trim(),
        location: effectiveLocation,
        address: address.trim(),
        description: description.trim() || undefined,
        budget: budgetRupees ? parseFloat(budgetRupees) : 0,
        status,
      };

      if (assignedInCharge) {
        payload.assignedInCharge = assignedInCharge;
      }
      if (startDate) {
        payload.startDate = startDate;
      }
      if (expectedCompletionDate) {
        payload.expectedCompletionDate = expectedCompletionDate;
      }

      if (isEditing) {
        await api.put(`/projects/${project!._id || project!.id}`, payload);
      } else {
        await api.post('/projects', payload);
      }

      onClose();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      if (err.status === 403 || err.message?.includes('Forbidden') || err.message?.includes('Requires one of roles')) {
        setError(
          `Permission Denied: Your current active session (${user?.name || user?.email || 'Site Staff'}) does not have Managing Director credentials to create projects. Please sign in as a Managing Director.`
        );
      } else {
        setError(err.message || 'Failed to save project. Verify code uniqueness.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Construction Project' : 'Create Construction Project'}
      description="Define the construction site name, code, and location for real-time weather monitoring."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isOwner && (
          <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-bold block text-sm text-amber-900 mb-0.5">Managing Director Privileges Required</span>
              <span>
                Your current session is signed in as <strong>{user?.name || user?.email || 'Site In-Charge'}</strong> (Site In-Charge). Construction project creation and modification are restricted to Managing Directors.
              </span>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="px-3 py-1.5 bg-navy-900 text-white rounded-lg text-xs font-semibold hover:bg-navy-800 transition-colors whitespace-nowrap shrink-0"
            >
              Sign In as MD
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <span>{error}</span>
            {error.includes('Managing Director') && (
              <button
                type="button"
                onClick={() => logout()}
                className="px-2.5 py-1 bg-rose-700 text-white rounded-lg text-[11px] font-semibold hover:bg-rose-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                Sign In as MD
              </button>
            )}
          </div>
        )}

        {/* Project Name and Code */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Input
              label="Project Name"
              placeholder="e.g. Metro Heights Commercial Complex"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <Input
              label="Project Code (Unique)"
              placeholder="e.g. PRJ-MHC-01"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={isEditing}
              required
            />
          </div>
        </div>

        {/* Construction Site Location (Location-Only Configuration) */}
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy-950 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-amber-600" />
              Construction Site Location
            </span>
            <span className="text-[10px] text-slate-500 font-medium">Automatic weather resolution</span>
          </div>

          <div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <Input
                  placeholder="e.g. Gachibowli, Hyderabad, Telangana, India"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    if (locationFeedback) setLocationFeedback(null);
                  }}
                  required
                />
              </div>

              <button
                type="button"
                onClick={handleVerifyLocation}
                disabled={isVerifyingLocation || !location.trim()}
                className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shrink-0 shadow-sm"
              >
                {isVerifyingLocation ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Verify Location</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Enter the site address, landmark, area, or city. BKR INFRA automatically resolves weather for this location.
            </p>
          </div>

          <Input
            label="Specific Site Address / Landmark (Optional)"
            placeholder="e.g. Plot B-9, Financial District, Sector 62"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />

          {locationFeedback && (
            <div
              className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                locationFeedback.startsWith('✓')
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              {locationFeedback.startsWith('✓') ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{locationFeedback}</span>
            </div>
          )}

          {locationCandidates.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] text-slate-600 font-semibold block">
                Multiple matching locations found — click to select:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {locationCandidates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectCandidate(c)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-amber-400 hover:bg-amber-50/50 text-xs text-navy-950 font-medium transition-colors text-left"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <Textarea
          label="Scope of Work & Description (Optional)"
          placeholder="Outline structural scope, foundation details, and architectural specifications..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Total Allocated Budget in Rupees (₹) (Optional)"
            type="number"
            step="1000"
            min="0"
            placeholder="e.g. 5000000 for ₹50 Lakhs"
            value={budgetRupees}
            onChange={(e) => setBudgetRupees(e.target.value)}
          />

          <Select
            label="Assigned Site In-Charge (Optional)"
            value={assignedInCharge}
            onChange={(e) => setAssignedInCharge(e.target.value)}
          >
            <option value="">-- Unassigned (Assign Later) --</option>
            {inChargeUsers.map((u) => (
              <option key={u._id || u.id} value={u._id || u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Start Date (Optional)"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />

          <Input
            label="Target Completion Date (Optional)"
            type="date"
            value={expectedCompletionDate}
            onChange={(e) => setExpectedCompletionDate(e.target.value)}
          />

          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            options={[
              { value: 'IN_PROGRESS', label: 'Active / In Progress' },
              { value: 'PLANNING', label: 'Planning Phase' },
              { value: 'ON_HOLD', label: 'On Hold' },
              { value: 'COMPLETED', label: 'Completed' },
            ]}
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 pt-3 border-t border-slate-100 [&>button]:w-full [&>button]:sm:w-auto">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="amber" isLoading={isLoading} disabled={!isOwner}>
            {isEditing ? 'Save Changes' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
