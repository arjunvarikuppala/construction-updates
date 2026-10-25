import React, { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input, Textarea, Select } from '../common/Input.js';
import { Project, ProjectStatus, User } from '../../types/index.js';
import { paiseToRupees } from '../../utils/currency.js';
import { api } from '../../api/client.js';

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

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [budgetRupees, setBudgetRupees] = useState('');
  const [assignedInCharge, setAssignedInCharge] = useState('');
  const [startDate, setStartDate] = useState('');
  const [expectedCompletionDate, setExpectedCompletionDate] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('IN_PROGRESS');

  const [inChargeUsers, setInChargeUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
        setLocation(project.location);
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
        setDescription('');
        setBudgetRupees('');
        setAssignedInCharge('');
        setStartDate(new Date().toISOString().split('T')[0]);
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        setExpectedCompletionDate(nextYear.toISOString().split('T')[0]);
        setStatus('IN_PROGRESS');
      }
      setError('');
    }
  }, [isOpen, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim() || !location.trim()) {
      setError('Project name, unique project code, and site location are required.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const payload: any = {
        name: name.trim(),
        code: code.toUpperCase().trim(),
        location: location.trim(),
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
      setError(err.message || 'Failed to save project. Verify code uniqueness.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Construction Project' : 'Create Construction Project'}
      description="Define the site name, unique code, site address, and optional in-charge assignment."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Input
              label="Project Name"
              placeholder="e.g. Metro Heights Phase 2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <Input
              label="Project Code (Unique)"
              placeholder="e.g. MHP-02"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={isEditing}
              required
            />
          </div>
        </div>

        <Input
          label="Site Location / Address"
          placeholder="e.g. Sector 62, Golf Course Ext., Gurugram"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
        />

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

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="amber" isLoading={isLoading}>
            {isEditing ? 'Save Changes' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
