import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, User, Calendar, ArrowRight } from 'lucide-react';
import { Project } from '../../types/index.js';
import { Badge } from '../common/Badge.js';
import { formatCompactINR, formatINR } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';

interface ProjectCardProps {
  project: Project;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const navigate = useNavigate();
  const id = project._id || project.id;
  const financials = project.financials;

  const burnRate = financials?.burnPercentage || 0;
  const burnColor =
    burnRate > 90 ? 'bg-rose-500' : burnRate > 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div
      onClick={() => navigate(`/projects/${id}`)}
      className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-card hover:shadow-card-hover hover:border-slate-300 transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
    >
      {/* Top Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
            {project.code}
          </span>
          <Badge status={project.status} size="sm" />
        </div>

        <h3 className="text-base font-bold text-navy-950 group-hover:text-navy-800 transition-colors line-clamp-1">
          {project.name}
        </h3>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
          <span className="truncate">{project.location}</span>
        </div>
      </div>

      {/* In-Charge & Timeline */}
      <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-slate-100 bg-slate-50/50 -mx-5 px-5">
        <div className="flex items-center gap-2 overflow-hidden">
          <User className="w-3.5 h-3.5 text-navy-700 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 block uppercase font-medium">In-Charge</span>
            <span className="font-semibold text-slate-800 truncate block">
              {project.assignedInCharge?.name || 'Unassigned'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-hidden">
          <Calendar className="w-3.5 h-3.5 text-navy-700 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 block uppercase font-medium">Target End</span>
            <span className="font-semibold text-slate-800 truncate block">
              {formatDate(project.expectedCompletionDate, 'MMM yyyy')}
            </span>
          </div>
        </div>
      </div>

      {/* Budget & Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-xs">
          <div>
            <span className="text-[11px] text-slate-500">Budget: </span>
            <span className="font-bold text-navy-950">{formatCompactINR(project.budget)}</span>
          </div>
          <div>
            <span className="text-[11px] text-slate-500">Spent: </span>
            <span className="font-bold text-emerald-700">
              {financials ? formatCompactINR(financials.approvedPaise) : '₹0'}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full ${burnColor} transition-all duration-500 rounded-full`}
            style={{ width: `${Math.min(100, burnRate)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
          <span>{burnRate}% utilized</span>
          {financials?.pendingPaise ? (
            <span className="text-amber-700 font-semibold">
              {formatCompactINR(financials.pendingPaise)} pending
            </span>
          ) : (
            <span className="text-slate-400">All cleared</span>
          )}
        </div>
      </div>

      {/* Footer View Link */}
      <div className="flex items-center justify-end text-xs font-semibold text-navy-900 group-hover:text-amber-600 transition-colors pt-1">
        <span>View Details</span>
        <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
      </div>
    </div>
  );
};
