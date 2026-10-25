import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Building2, Filter } from 'lucide-react';
import { ProjectCard } from '../components/projects/ProjectCard.js';
import { ProjectModal } from '../components/projects/ProjectModal.js';
import { Button } from '../components/common/Button.js';
import { Input, Select } from '../components/common/Input.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { useAuth } from '../context/AuthContext.js';
import { Project } from '../types/index.js';
import { api } from '../api/client.js';

export const ProjectsPage: React.FC = () => {
  const { isOwner } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['projects', searchTerm, statusFilter],
    queryFn: async () => {
      let queryParams = new URLSearchParams();
      if (searchTerm.trim()) queryParams.append('search', searchTerm.trim());
      if (statusFilter !== 'ALL') queryParams.append('status', statusFilter);

      return api.get<{ count: number; projects: Project[] }>(`/projects?${queryParams.toString()}`);
    },
    refetchInterval: 20000,
  });

  const projects = data?.projects || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
            {isOwner ? 'Construction Projects Directory' : 'My Assigned Projects'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {isOwner
              ? 'Multi-site portfolio, project budgets, and assigned site in-charge engineers.'
              : 'Authorized construction sites and assigned operational parameters.'}
          </p>
        </div>

        {isOwner && (
          <Button
            variant="amber"
            onClick={() => setIsModalOpen(true)}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Create New Project
          </Button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="w-full sm:flex-1">
          <Input
            placeholder="Search by project name, unique code, or location..."
            leftIcon={<Search className="w-4 h-4" />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="w-full sm:w-48">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'IN_PROGRESS', label: 'In Progress / Active' },
              { value: 'PLANNING', label: 'Planning Phase' },
              { value: 'ON_HOLD', label: 'On Hold' },
              { value: 'COMPLETED', label: 'Completed' },
            ]}
          />
        </div>
      </div>

      {/* Projects Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <LoadingSkeleton rows={1} height="h-64" />
          <LoadingSkeleton rows={1} height="h-64" />
          <LoadingSkeleton rows={1} height="h-64" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No construction projects found"
          description={
            searchTerm || statusFilter !== 'ALL'
              ? 'Try adjusting your filters or search keywords.'
              : 'Create your first construction project to begin tracking daily reports and expenses.'
          }
          actionText={isOwner ? 'Create Project' : undefined}
          onAction={isOwner ? () => setIsModalOpen(true) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project) => (
            <ProjectCard key={project._id || project.id} project={project} />
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {isOwner && (
        <ProjectModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  );
};
