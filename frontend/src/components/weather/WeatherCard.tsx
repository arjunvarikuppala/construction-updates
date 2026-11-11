import React from 'react';
import {
  MapPin,
  RefreshCw,
  Droplets,
  Wind,
  CloudRain,
  Thermometer,
  Clock,
  AlertTriangle,
  Flame,
  Zap,
  Info,
  ExternalLink,
  Settings,
} from 'lucide-react';
import { WeatherIcon } from './WeatherIcon.js';
import { WeatherData, WeatherAlert } from '../../types/index.js';

interface WeatherCardProps {
  projectId: string;
  projectName?: string;
  projectCode?: string;
  location?: string;
  weather?: WeatherData;
  isConfigured?: boolean;
  cached?: boolean;
  isStale?: boolean;
  fetchedAt?: string;
  statusMessage?: string;
  variant?: 'hero' | 'compact' | 'dashboard';
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onClick?: () => void;
  onConfigureLocation?: () => void;
  canConfigureLocation?: boolean;
}

export const WeatherCard: React.FC<WeatherCardProps> = ({
  projectId,
  projectName,
  projectCode,
  location,
  weather,
  isConfigured = true,
  cached = false,
  isStale = false,
  fetchedAt,
  statusMessage,
  variant = 'hero',
  isLoading = false,
  isRefreshing = false,
  onRefresh,
  onClick,
  onConfigureLocation,
  canConfigureLocation = false,
}) => {
  // Format observation / fetched timestamp relative or clean
  const formatTime = (isoString?: string | Date) => {
    if (!isoString) return 'Just now';
    try {
      const date = typeof isoString === 'string' ? new Date(isoString) : isoString;
      if (!date || isNaN(date.getTime())) return 'Just now';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Just now';
    }
  };

  const getAlertIcon = (type: WeatherAlert['type']) => {
    switch (type) {
      case 'HEAVY_RAIN':
        return <CloudRain className="w-4 h-4 text-blue-700" />;
      case 'THUNDERSTORM':
        return <Zap className="w-4 h-4 text-amber-700" />;
      case 'EXCESSIVE_HEAT':
        return <Flame className="w-4 h-4 text-rose-700" />;
      case 'STRONG_WINDS':
        return <Wind className="w-4 h-4 text-orange-700" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-amber-700" />;
    }
  };

  const getAlertStyle = (severity: WeatherAlert['severity']) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-rose-50 border-rose-300 text-rose-900';
      case 'WARNING':
        return 'bg-amber-50 border-amber-300 text-amber-900';
      default:
        return 'bg-blue-50 border-blue-200 text-blue-900';
    }
  };

  // State 1: Loading
  if (isLoading) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-card animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-4 w-32 bg-slate-200 rounded" />
          <div className="h-6 w-16 bg-slate-200 rounded-full" />
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-200 rounded-2xl" />
          <div className="space-y-2">
            <div className="h-8 w-20 bg-slate-200 rounded" />
            <div className="h-3 w-28 bg-slate-200 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
          <div className="h-10 bg-slate-100 rounded-xl" />
          <div className="h-10 bg-slate-100 rounded-xl" />
          <div className="h-10 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  // State 2: Location Missing / Unconfigured
  if (!isConfigured || (!location && !weather)) {
    return (
      <div
        className={`bg-white rounded-3xl border-2 border-dashed border-amber-300 p-5 shadow-card space-y-3.5 transition-all ${
          onClick ? 'cursor-pointer hover:border-amber-400' : ''
        }`}
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-navy-950 flex items-center gap-1.5">
                {projectCode && (
                  <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                    {projectCode}
                  </span>
                )}
                <span>{projectName || 'Construction Site'}</span>
              </h4>
              <span className="text-[11px] text-amber-800 font-semibold block mt-0.5">
                Site Location Coordinates Missing
              </span>
            </div>
          </div>
          {projectCode && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200 shrink-0">
              Setup Required
            </span>
          )}
        </div>

        <p className="text-xs text-slate-600 leading-relaxed bg-amber-50/50 p-3 rounded-2xl border border-amber-100">
          {statusMessage ||
            'Weather readings require a verified construction site address or GPS coordinates. Unrelated or simulated weather data is never displayed.'}
        </p>

        {canConfigureLocation && onConfigureLocation && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConfigureLocation();
            }}
            className="w-full py-2 px-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Settings className="w-3.5 h-3.5" />
            Configure Site Location Now
          </button>
        )}
      </div>
    );
  }

  // State 3: Weather Service Error / Fallback (No readings returned)
  if (!weather) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-navy-950 truncate max-w-[200px]">
              {location || projectName || 'Site Location'}
            </span>
          </div>
          {onRefresh && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={isRefreshing}
              className="p-1 text-slate-400 hover:text-navy-950 rounded-lg hover:bg-slate-100"
              title="Refresh weather"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-navy-950">Live Weather Temporarily Unavailable</p>
          <p className="text-[11px] text-slate-500">
            {statusMessage || 'Unable to contact meteorological service. Please retry in a few moments.'}
          </p>
        </div>
      </div>
    );
  }

  const temperature = weather.temperature ?? 0;
  const feelsLike = weather.feelsLike ?? temperature;
  const condition = weather.condition || 'Clear';
  const icon = weather.icon || 'sunny';
  const humidity = weather.humidity ?? 0;
  const windSpeed = weather.windSpeed ?? 0;
  const precipitationProbability = weather.precipitationProbability ?? 0;
  const observationTime = weather.observationTime;
  const alerts = Array.isArray(weather.alerts) ? weather.alerts : [];

  const isHero = variant === 'hero';

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-3xl border border-amber-300/80 shadow-card transition-all duration-200 overflow-hidden ${
        onClick ? 'cursor-pointer hover:border-amber-400 hover:shadow-lg' : ''
      } ${isHero ? 'p-5 sm:p-6' : 'p-4 sm:p-5'}`}
    >
      {/* Top Header Bar */}
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {projectCode && (
              <span className="font-mono text-[11px] font-bold text-amber-800 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                {projectCode}
              </span>
            )}
            <h3 className="text-xs sm:text-sm font-bold text-navy-950 truncate">
              {projectName || 'Site Weather & Conditions'}
            </h3>
          </div>

          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
            <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
            <span className="truncate">{location || 'Construction Site'}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Freshness / Verification Badge */}
          {isStale ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200" title="Offline cached data">
              <Clock className="w-3 h-3 text-slate-500" />
              Cached
            </span>
          ) : cached ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80" title="Verified observation">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80" title="Live observation">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Verified Live
            </span>
          )}

          {/* Refresh Action Button */}
          {onRefresh && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={isRefreshing}
              className="p-1 text-slate-400 hover:text-navy-950 hover:bg-slate-100 rounded-lg transition-colors"
              title="Refresh weather"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
            </button>
          )}

          {onClick && (
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 hover:text-navy-950 ml-0.5" />
          )}
        </div>
      </div>

      {/* Main Temperature & Condition Display */}
      <div className="py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 shadow-inner">
            <WeatherIcon icon={icon} className="w-7 h-7 sm:w-8 sm:h-8" />
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-navy-950 tracking-tight">
                {temperature}°C
              </span>
              <span className="text-xs text-slate-500 font-medium">
                Feels {feelsLike}°C
              </span>
            </div>
            <span className="text-xs font-semibold text-slate-700 block truncate mt-0.5">
              {condition}
            </span>
          </div>
        </div>

        {/* Rain Probability Pill if available */}
        {precipitationProbability > 0 && (
          <div className="text-right shrink-0">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
              <CloudRain className="w-3.5 h-3.5 text-blue-600" />
              {precipitationProbability}% rain
            </span>
          </div>
        )}
      </div>

      {/* Metrics Row: Humidity, Wind, Rain Chance, Observation Time */}
      <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-100 text-xs">
        {/* Humidity */}
        <div className="bg-slate-50/80 p-2 sm:p-2.5 rounded-xl border border-slate-100/80">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block flex items-center gap-1">
            <Droplets className="w-3 h-3 text-sky-500" />
            Humidity
          </span>
          <span className="font-bold text-navy-950 text-xs sm:text-sm mt-0.5 block">
            {humidity}%
          </span>
        </div>

        {/* Wind Speed */}
        <div className="bg-slate-50/80 p-2 sm:p-2.5 rounded-xl border border-slate-100/80">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block flex items-center gap-1">
            <Wind className="w-3 h-3 text-teal-500" />
            Wind
          </span>
          <span className="font-bold text-navy-950 text-xs sm:text-sm mt-0.5 block truncate">
            {windSpeed} <span className="text-[10px] font-medium text-slate-500">km/h</span>
          </span>
        </div>

        {/* Rain Probability / Condition */}
        <div className="bg-slate-50/80 p-2 sm:p-2.5 rounded-xl border border-slate-100/80">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block flex items-center gap-1">
            <CloudRain className="w-3 h-3 text-blue-500" />
            Rain Chance
          </span>
          <span className="font-bold text-navy-950 text-xs sm:text-sm mt-0.5 block">
            {precipitationProbability}%
          </span>
        </div>
      </div>

      {/* Timestamp Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2.5 mt-1 border-t border-slate-100/60">
        <span>Observed: {formatTime(observationTime)}</span>
        <span>Synced: {formatTime(fetchedAt)}</span>
      </div>

      {/* Construction Weather Alerts Section */}
      {alerts && alerts.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`p-2.5 sm:p-3 rounded-2xl border text-xs space-y-1 ${getAlertStyle(alert.severity)}`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                {getAlertIcon(alert.type)}
                <span>{alert.headline}</span>
                <span className="text-[9px] uppercase tracking-wider ml-auto font-black px-1.5 py-0.2 rounded bg-white/70">
                  {alert.severity}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-700">
                {alert.description}
              </p>
              <div className="text-[11px] font-medium text-slate-900 bg-white/60 p-2 rounded-xl mt-1">
                <span className="font-bold">Site Precaution: </span>
                {alert.actionableAdvice}
              </div>
            </div>
          ))}

          {/* Mandatory Safety Notice Disclaimer */}
          <div className="flex items-start gap-1.5 p-2 bg-slate-50 rounded-xl text-[10px] text-slate-500 leading-tight border border-slate-200/60">
            <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
            <span>
              Advisory only. Weather alerts are based on meteorological forecasts and do not replace official site safety procedures or structural engineer directives.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
