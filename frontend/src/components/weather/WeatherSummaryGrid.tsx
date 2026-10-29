import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CloudSun,
  AlertTriangle,
  RefreshCw,
  MapPin,
  CheckCircle2,
  Building2,
  SlidersHorizontal,
} from 'lucide-react';
import { WeatherCard } from './WeatherCard.js';
import { ProjectWeatherSummary } from '../../types/index.js';
import { LoadingSkeleton } from '../common/LoadingSkeleton.js';
import { api } from '../../api/client.js';

interface WeatherSummaryGridProps {
  onConfigureProjectLocation?: (projectId: string) => void;
}

export const WeatherSummaryGrid: React.FC<WeatherSummaryGridProps> = ({
  onConfigureProjectLocation,
}) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'ALL' | 'WARNINGS' | 'CONFIGURED' | 'UNCONFIGURED'>('ALL');

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const {
    data: weatherResponse,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['weather-summary-across-projects'],
    queryFn: () => api.get<{ success: boolean; count: number; projects: ProjectWeatherSummary[] }>('/projects/weather-summary'),
    refetchInterval: 10 * 60 * 1000, // 10 minutes automatic sync
  });

  const handleManualRefreshAll = async () => {
    setIsManualRefreshing(true);
    try {
      await api.get('/projects/weather-summary?refresh=true');
      await refetch();
    } catch {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const projects = weatherResponse?.projects || [];

  const projectsWithWarnings = projects.filter(
    (p) => p.weather?.alerts && p.weather.alerts.length > 0
  );
  const unconfiguredProjects = projects.filter((p) => !p.isConfigured);

  const filteredProjects = projects.filter((p) => {
    if (filter === 'WARNINGS') return p.weather?.alerts && p.weather.alerts.length > 0;
    if (filter === 'CONFIGURED') return p.isConfigured;
    if (filter === 'UNCONFIGURED') return !p.isConfigured;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-800 flex items-center justify-center font-bold">
              <CloudSun className="w-4 h-4 text-amber-700" />
            </div>
            <h2 className="text-lg sm:text-xl font-black text-navy-950 tracking-tight">
              Weather Across Projects
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Live meteorological conditions, site temperatures, and construction safety warnings for every authorized project.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Refresh All Action */}
          <button
            type="button"
            onClick={handleManualRefreshAll}
            disabled={isRefetching || isLoading || isManualRefreshing}
            className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching || isManualRefreshing ? 'animate-spin text-amber-600' : 'text-slate-500'}`} />
            <span>{isRefetching || isManualRefreshing ? 'Refreshing...' : 'Refresh All'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Pills & Filter Chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setFilter('ALL')}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
            filter === 'ALL'
              ? 'bg-navy-900 text-white shadow-sm'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          All Sites ({projects.length})
        </button>

        {projectsWithWarnings.length > 0 && (
          <button
            type="button"
            onClick={() => setFilter('WARNINGS')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 ${
              filter === 'WARNINGS'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Warnings Active ({projectsWithWarnings.length})</span>
          </button>
        )}

        {unconfiguredProjects.length > 0 && (
          <button
            type="button"
            onClick={() => setFilter('UNCONFIGURED')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 ${
              filter === 'UNCONFIGURED'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'bg-rose-50 border border-rose-200 text-rose-800 hover:bg-rose-100'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Missing Coordinates ({unconfiguredProjects.length})</span>
          </button>
        )}
      </div>

      {/* Loading Skeletons */}
      {isLoading && !weatherResponse && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <LoadingSkeleton rows={1} height="h-48" />
          <LoadingSkeleton rows={1} height="h-48" />
          <LoadingSkeleton rows={1} height="h-48" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredProjects.length === 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 mx-auto flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-navy-950">No construction projects match the selected filter.</p>
          <p className="text-xs text-slate-500">
            {filter !== 'ALL'
              ? 'Try resetting the filter to view all project sites.'
              : 'Create construction projects to monitor live site meteorological conditions.'}
          </p>
          {filter !== 'ALL' && (
            <button
              onClick={() => setFilter('ALL')}
              className="text-xs font-bold text-amber-700 hover:text-amber-800 underline"
            >
              Show all projects
            </button>
          )}
        </div>
      )}

      {/* Responsive Weather Card Grid: 1 col mobile, 2 col tablet/laptop, 3 col desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProjects.map((item) => (
          <WeatherCard
            key={item.projectId}
            projectId={item.projectId}
            projectName={item.projectName}
            projectCode={item.projectCode}
            location={item.location}
            weather={item.weather}
            isConfigured={item.isConfigured}
            cached={item.cached}
            isStale={item.isStale}
            fetchedAt={item.fetchedAt}
            statusMessage={item.statusMessage}
            variant="dashboard"
            canConfigureLocation={!item.isConfigured}
            onConfigureLocation={() => {
              if (onConfigureProjectLocation) {
                onConfigureProjectLocation(item.projectId);
              } else {
                navigate(`/projects/${item.projectId}`);
              }
            }}
            onClick={() => navigate(`/projects/${item.projectId}`)}
            onRefresh={() => refetch()}
            isRefreshing={isRefetching}
          />
        ))}
      </div>
    </div>
  );
};
