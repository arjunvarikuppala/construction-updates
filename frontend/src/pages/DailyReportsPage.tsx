import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Filter, ClipboardList, AlertCircle, Calendar } from 'lucide-react';
import { DailyReportCard } from '../components/reports/DailyReportCard.js';
import { Button } from '../components/common/Button.js';
import { Select, Input } from '../components/common/Input.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { useAuth } from '../context/AuthContext.js';
import { DailyReport, Project } from '../types/index.js';
import { api } from '../api/client.js';

export const DailyReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const { isOwner } = useAuth();

  const [selectedProject, setSelectedProject] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Fetch projects for filter
  const { data: projectsData } = useQuery({
    queryKey: ['projects-reports-filter'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  // Fetch daily reports
  const { data, isLoading } = useQuery({
    queryKey: ['daily-reports', selectedProject, searchTerm, startDate, endDate],
    queryFn: async () => {
      let params = new URLSearchParams();
      if (selectedProject) params.append('projectId', selectedProject);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      return api.get<{ count: number; reports: DailyReport[] }>(`/daily-reports?${params.toString()}`);
    },
    refetchInterval: 15000,
  });

  // Fetch missing reports alert for Owner
  const { data: missingData } = useQuery({
    queryKey: ['missing-reports'],
    queryFn: () => api.get<{ count: number; missingReports: any[] }>('/daily-reports/missing'),
    enabled: isOwner,
  });

  const reports = data?.reports || [];
  const projects = projectsData?.projects || [];
  const missingCount = missingData?.count || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
            Daily Construction Progress Reports
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Verified logs of completed work, quantities, labour attendance, equipment, and on-site photos.
          </p>
        </div>

        <Button
          variant="amber"
          onClick={() => navigate('/reports/new')}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Submit Daily Report
        </Button>
      </div>

      {/* Missing Reports Indicator (Requirement 6) */}
      {isOwner && missingCount > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-xs text-amber-950 uppercase tracking-wider block">
              Missing Site Reports Flagged ({missingCount})
            </span>
            <p className="text-xs text-amber-900">
              There are {missingCount} site days in the last 7 days where active construction projects have no submitted daily report.
            </p>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="sm:col-span-1">
          <Input
            placeholder="Search by Title of Work..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <Select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
        >
          <option value="">All Construction Projects</option>
          {projects.map((p) => (
            <option key={p._id || p.id} value={p._id || p.id}>
              {p.code} - {p.name}
            </option>
          ))}
        </Select>

        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="Start date"
        />

        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="End date"
        />
      </div>

      {/* Reports List */}
      {isLoading ? (
        <div className="space-y-4">
          <LoadingSkeleton rows={1} height="h-44" />
          <LoadingSkeleton rows={1} height="h-44" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No daily construction reports found"
          description="Submit a daily report to record on-site quantities, labour counts, and site photos."
          actionText="Submit Daily Report"
          onAction={() => navigate('/reports/new')}
        />
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <DailyReportCard key={report._id || report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
};
