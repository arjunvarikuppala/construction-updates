import { Project, IProject } from '../models/Project.js';
import { WeatherCache, IWeatherData, IWeatherAlert } from '../models/WeatherCache.js';
import { ProjectWeatherSummary } from '../types/index.js';

const CACHE_TTL_MINUTES = parseInt(process.env.WEATHER_CACHE_TTL_MINUTES || '10', 10);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;
const EXTERNAL_TIMEOUT_MS = 6000;

// In-memory cache for resolved location text -> coordinates
const GEOCODE_CACHE = new Map<
  string,
  Array<{
    name: string;
    latitude: number;
    longitude: number;
    city?: string;
    state?: string;
    country?: string;
  }>
>();

// Known coordinates fallback for offline or restricted development environments
const KNOWN_COORDINATES: Record<string, { lat: number; lon: number; city: string; state: string; country: string }> = {
  'noida': { lat: 28.5355, lon: 77.3910, city: 'Noida', state: 'Uttar Pradesh', country: 'India' },
  'sector 62': { lat: 28.6280, lon: 77.3649, city: 'Noida', state: 'Uttar Pradesh', country: 'India' },
  'bengaluru': { lat: 12.9716, lon: 77.5946, city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  'bangalore': { lat: 12.9716, lon: 77.5946, city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  'whitefield': { lat: 12.9698, lon: 77.7499, city: 'Bengaluru', state: 'Karnataka', country: 'India' },
  'hyderabad': { lat: 17.3850, lon: 78.4867, city: 'Hyderabad', state: 'Telangana', country: 'India' },
  'gachibowli': { lat: 17.4401, lon: 78.3489, city: 'Hyderabad', state: 'Telangana', country: 'India' },
  'mumbai': { lat: 19.0760, lon: 72.8777, city: 'Mumbai', state: 'Maharashtra', country: 'India' },
  'delhi': { lat: 28.6139, lon: 77.2090, city: 'New Delhi', state: 'Delhi', country: 'India' },
  'pune': { lat: 18.5204, lon: 73.8567, city: 'Pune', state: 'Maharashtra', country: 'India' },
  'chennai': { lat: 13.0827, lon: 80.2707, city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
  'kolkata': { lat: 22.5726, lon: 88.3639, city: 'Kolkata', state: 'West Bengal', country: 'India' },
  'gurgaon': { lat: 28.4595, lon: 77.0266, city: 'Gurugram', state: 'Haryana', country: 'India' },
  'gurugram': { lat: 28.4595, lon: 77.0266, city: 'Gurugram', state: 'Haryana', country: 'India' },
  'ahmedabad': { lat: 23.0225, lon: 72.5714, city: 'Ahmedabad', state: 'Gujarat', country: 'India' },
};

/**
 * Interpret WMO Weather Code
 * Standard meteorological classification used by Open-Meteo
 */
function interpretWmoCode(code: number): { condition: string; icon: string } {
  switch (code) {
    case 0:
      return { condition: 'Clear Sky / Sunny', icon: 'sunny' };
    case 1:
      return { condition: 'Mainly Clear', icon: 'sunny' };
    case 2:
      return { condition: 'Partly Cloudy', icon: 'partly-cloudy' };
    case 3:
      return { condition: 'Overcast', icon: 'cloudy' };
    case 45:
    case 48:
      return { condition: 'Fog / Mist', icon: 'fog' };
    case 51:
    case 53:
    case 55:
      return { condition: 'Light Drizzle', icon: 'drizzle' };
    case 56:
    case 57:
      return { condition: 'Freezing Drizzle', icon: 'drizzle' };
    case 61:
      return { condition: 'Light Rain', icon: 'rain' };
    case 63:
      return { condition: 'Moderate Rain', icon: 'rain' };
    case 65:
      return { condition: 'Heavy Rain', icon: 'rain' };
    case 66:
    case 67:
      return { condition: 'Freezing Rain', icon: 'rain' };
    case 71:
    case 73:
    case 75:
    case 77:
      return { condition: 'Snow Fall', icon: 'snow' };
    case 80:
      return { condition: 'Light Rain Showers', icon: 'rain-showers' };
    case 81:
      return { condition: 'Moderate Rain Showers', icon: 'rain-showers' };
    case 82:
      return { condition: 'Violent Rain Showers', icon: 'rain-showers' };
    case 95:
      return { condition: 'Thunderstorm', icon: 'thunderstorm' };
    case 96:
    case 99:
      return { condition: 'Severe Thunderstorm with Hail', icon: 'thunderstorm' };
    default:
      return { condition: 'Cloudy Intervals', icon: 'partly-cloudy' };
  }
}

/**
 * Evaluate actionable Construction Weather Alerts
 * Advisory warnings based on on-ground construction safety limits
 */
function evaluateConstructionAlerts(params: {
  temperature: number;
  feelsLike: number;
  conditionCode: number;
  windSpeed: number;
  precipitation: number;
  precipitationProbability: number;
}): IWeatherAlert[] {
  const alerts: IWeatherAlert[] = [];
  const { temperature, feelsLike, conditionCode, windSpeed, precipitation, precipitationProbability } = params;

  // 1. Heavy Rainfall Alert
  const isRainCode = [63, 65, 81, 82, 95, 96, 99].includes(conditionCode);
  if (precipitation >= 4 || (isRainCode && precipitationProbability >= 65)) {
    alerts.push({
      type: 'HEAVY_RAIN',
      severity: precipitation >= 10 || conditionCode === 65 ? 'CRITICAL' : 'WARNING',
      headline: 'Heavy Rainfall Advisory',
      description: `Significant rain recorded or forecast (${precipitation} mm, ${precipitationProbability}% chance).`,
      actionableAdvice:
        'Protect exposed reinforcement steel from rust, ensure site drainage pumps are cleared, secure open trenching, and halt sensitive exterior concrete pouring.',
    });
  }

  // 2. Thunderstorm & Lightning Alert
  if ([95, 96, 99].includes(conditionCode)) {
    alerts.push({
      type: 'THUNDERSTORM',
      severity: 'CRITICAL',
      headline: 'Thunderstorm & Lightning Hazard',
      description: 'Thunderstorm activity detected within construction site perimeter.',
      actionableAdvice:
        'Immediately cease tower crane, boom, and high-elevation scaffolding operations. Direct all site personnel to seek grounded indoor shelter.',
    });
  }

  // 3. Excessive Heat Alert
  if (temperature >= 38 || feelsLike >= 40) {
    alerts.push({
      type: 'EXCESSIVE_HEAT',
      severity: temperature >= 42 || feelsLike >= 44 ? 'CRITICAL' : 'WARNING',
      headline: 'Excessive Heat Advisory',
      description: `Ambient temperature at ${temperature}°C (Heat Index feels like ${feelsLike}°C).`,
      actionableAdvice:
        'Enforce mandatory shaded hydration intervals for all labour. Apply curing compound or wet burlap on fresh concrete promptly to prevent plastic shrinkage cracking.',
    });
  }

  // 4. Strong Winds Alert
  if (windSpeed >= 38) {
    alerts.push({
      type: 'STRONG_WINDS',
      severity: windSpeed >= 50 ? 'CRITICAL' : 'WARNING',
      headline: 'High Wind Velocity Warning',
      description: `Wind gusts recorded at ${windSpeed} km/h.`,
      actionableAdvice:
        'Inspect and anchor scaffolding debris nets, corrugated sheeting, and temporary site hoardings. Restrict high-altitude crane lifting and suspended platform work.',
    });
  }

  return alerts;
}

/**
 * Fetch live weather from Open-Meteo
 */
async function fetchOpenMeteoWeather(lat: number, lon: number): Promise<IWeatherData> {
  const apiKey = process.env.WEATHER_API_KEY || process.env.OPEN_METEO_API_KEY;
  let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability&timezone=auto`;

  if (apiKey) {
    url += `&apikey=${encodeURIComponent(apiKey)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SiteTrack-Construction-App/1.0',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Open-Meteo API returned status ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    const current = data.current || {};
    const hourly = data.hourly || {};

    const temp = Number(current.temperature_2m ?? 28);
    const feelsLike = Number(current.apparent_temperature ?? temp);
    const humidity = Number(current.relative_humidity_2m ?? 50);
    const windSpeed = Number(current.wind_speed_10m ?? 10);
    const windDirection = current.wind_direction_10m ? Number(current.wind_direction_10m) : undefined;
    const precipitation = Number(current.precipitation ?? 0);
    const conditionCode = Number(current.weather_code ?? 0);

    // Compute rain probability for the current hour
    let precipitationProbability = 0;
    if (Array.isArray(hourly.precipitation_probability) && hourly.precipitation_probability.length > 0) {
      const now = new Date();
      const currentHour = now.getHours();
      precipitationProbability = Number(hourly.precipitation_probability[currentHour] ?? hourly.precipitation_probability[0] ?? 0);
    }

    const { condition, icon } = interpretWmoCode(conditionCode);
    const alerts = evaluateConstructionAlerts({
      temperature: temp,
      feelsLike,
      conditionCode,
      windSpeed,
      precipitation,
      precipitationProbability,
    });

    return {
      temperature: Math.round(temp * 10) / 10,
      feelsLike: Math.round(feelsLike * 10) / 10,
      condition,
      conditionCode,
      icon,
      humidity: Math.round(humidity),
      windSpeed: Math.round(windSpeed * 10) / 10,
      windDirection,
      precipitationProbability: Math.round(precipitationProbability),
      precipitation: Math.round(precipitation * 10) / 10,
      observationTime: current.time ? new Date(current.time) : new Date(),
      alerts,
    };
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

export class WeatherService {
  /**
   * Geocode a location text (e.g. "Whitefield, Bengaluru" or "Sector 62 Noida")
   */
  static async geocode(query: string): Promise<Array<{
    name: string;
    latitude: number;
    longitude: number;
    city?: string;
    state?: string;
    country?: string;
  }>> {
    const clean = (query || '').trim().toLowerCase();
    if (!clean) return [];

    if (GEOCODE_CACHE.has(clean)) {
      return GEOCODE_CACHE.get(clean)!;
    }

    // Check known coordinates cache first
    for (const [key, coords] of Object.entries(KNOWN_COORDINATES)) {
      if (clean.includes(key)) {
        const result = [
          {
            name: `${coords.city}, ${coords.state}, ${coords.country}`,
            latitude: coords.lat,
            longitude: coords.lon,
            city: coords.city,
            state: coords.state,
            country: coords.country,
          },
        ];
        GEOCODE_CACHE.set(clean, result);
        return result;
      }
    }

    // Progressive search queries for granular construction addresses
    const searchQueries = [query.trim()];
    if (query.includes(',')) {
      const parts = query.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 2) {
        searchQueries.push(parts.slice(-3).join(', '));
        searchQueries.push(parts.slice(-2).join(', '));
      }
      if (parts.length >= 2) {
        searchQueries.push(parts[parts.length - 2]);
      }
    }

    for (const q of searchQueries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SiteTrack-Construction-App/1.0',
          },
        });

        clearTimeout(timer);

        if (res.ok) {
          const data: any = await res.json();
          if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            const mapped = data.results.map((r: any) => ({
              name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
              latitude: r.latitude,
              longitude: r.longitude,
              city: r.name,
              state: r.admin1 || '',
              country: r.country || 'India',
            }));
            GEOCODE_CACHE.set(clean, mapped);
            return mapped;
          }
        }
      } catch {
        clearTimeout(timer);
      }
    }

    return [];
  }

  /**
   * Resolve location text entered by MD into coordinates and canonical location string
   */
  static async resolveLocationText(locationText: string): Promise<{
    resolved: boolean;
    latitude?: number;
    longitude?: number;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    error?: string;
  }> {
    const trimmed = (locationText || '').trim();
    if (!trimmed) {
      return { resolved: false, error: 'Location text is required.' };
    }

    const matches = await this.geocode(trimmed);
    if (matches.length === 0) {
      return {
        resolved: false,
        error: `Unable to resolve construction site location '${trimmed}'. Please enter a recognized area, city, or address (e.g. 'Gachibowli, Hyderabad, Telangana, India').`,
      };
    }

    const best = matches[0];
    return {
      resolved: true,
      latitude: best.latitude,
      longitude: best.longitude,
      name: best.name,
      city: best.city,
      state: best.state,
      country: best.country,
    };
  }

  /**
   * Resolve coordinates for a project if not explicitly set
   */
  static async resolveProjectCoordinates(project: IProject): Promise<{ latitude: number; longitude: number } | null> {
    if (
      project.latitude !== undefined &&
      project.latitude !== null &&
      project.longitude !== undefined &&
      project.longitude !== null
    ) {
      return { latitude: project.latitude, longitude: project.longitude };
    }

    // Try geocoding from address/city/location
    const searchQuery = [project.address, project.city, project.state, project.location]
      .filter(Boolean)
      .join(' ');

    if (!searchQuery.trim()) {
      return null;
    }

    const results = await this.geocode(searchQuery);
    if (results.length > 0) {
      const best = results[0];
      // Save geocoded coordinates to project document for subsequent lookups
      try {
        await Project.findByIdAndUpdate(project._id, {
          latitude: best.latitude,
          longitude: best.longitude,
          city: project.city || best.city,
          state: project.state || best.state,
          country: project.country || best.country,
        });
        project.latitude = best.latitude;
        project.longitude = best.longitude;
      } catch (e) {
        console.warn('Failed to persist geocoded coordinates to project:', e);
      }
      return { latitude: best.latitude, longitude: best.longitude };
    }

    return null;
  }

  /**
   * Invalidate cached weather when a project location is modified
   */
  static async invalidateCache(projectId: string): Promise<void> {
    try {
      await WeatherCache.deleteOne({ projectId });
    } catch (e) {
      console.warn('Failed to invalidate weather cache for project:', projectId, e);
    }
  }

  /**
   * Get weather for a single project
   */
  static async getProjectWeather(
    project: IProject,
    options: { forceRefresh?: boolean } = {}
  ): Promise<{
    isConfigured: boolean;
    weather?: IWeatherData;
    cached: boolean;
    isStale: boolean;
    fetchedAt: Date;
    statusMessage?: string;
  }> {
    const coords = await this.resolveProjectCoordinates(project);

    if (!coords) {
      return {
        isConfigured: false,
        cached: false,
        isStale: false,
        fetchedAt: new Date(),
        statusMessage:
          'Project site location or coordinates not yet configured. Please configure site address in Project Management.',
      };
    }

    const now = new Date();

    // Check existing cache
    let cacheDoc = await WeatherCache.findOne({ projectId: project._id });

    if (
      cacheDoc &&
      !options.forceRefresh &&
      cacheDoc.expiresAt.getTime() > now.getTime() &&
      !cacheDoc.isStale
    ) {
      return {
        isConfigured: true,
        weather: cacheDoc.weather,
        cached: true,
        isStale: false,
        fetchedAt: cacheDoc.fetchedAt,
      };
    }

    // Cache is expired or force refresh requested: Fetch from provider
    try {
      const freshWeather = await fetchOpenMeteoWeather(coords.latitude, coords.longitude);
      const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

      const locationName = [project.city, project.state, project.location].filter(Boolean)[0] || 'Site Location';

      cacheDoc = await WeatherCache.findOneAndUpdate(
        { projectId: project._id },
        {
          projectId: project._id,
          locationName,
          latitude: coords.latitude,
          longitude: coords.longitude,
          weather: freshWeather,
          provider: 'Open-Meteo',
          fetchedAt: now,
          expiresAt,
          isStale: false,
          lastError: undefined,
        },
        { upsert: true, new: true }
      );

      return {
        isConfigured: true,
        weather: freshWeather,
        cached: false,
        isStale: false,
        fetchedAt: now,
      };
    } catch (apiError: any) {
      console.warn(`[WeatherService] External API fetch failed for project ${project.code}:`, apiError.message);

      // Graceful fallback to stale cache if available
      if (cacheDoc && cacheDoc.weather) {
        return {
          isConfigured: true,
          weather: cacheDoc.weather,
          cached: true,
          isStale: true,
          fetchedAt: cacheDoc.fetchedAt,
          statusMessage: 'Live weather provider temporarily unreachable; displaying last recorded observations.',
        };
      }

      // If no cache exists, check known coordinates fallback with typical regional values
      return {
        isConfigured: true,
        cached: false,
        isStale: true,
        fetchedAt: now,
        statusMessage: `Weather service temporarily unavailable: ${apiError.message}`,
      };
    }
  }

  /**
   * Get weather summary across multiple authorized projects
   */
  static async getProjectsWeatherSummary(
    projects: IProject[],
    options: { forceRefresh?: boolean } = {}
  ): Promise<ProjectWeatherSummary[]> {
    const summaries: ProjectWeatherSummary[] = [];

    for (const project of projects) {
      const result = await this.getProjectWeather(project, options);

      summaries.push({
        projectId: project._id.toString(),
        projectName: project.name,
        projectCode: project.code,
        location: project.location,
        coordinates: {
          latitude: project.latitude ?? null,
          longitude: project.longitude ?? null,
        },
        isConfigured: result.isConfigured,
        weather: result.weather,
        isStale: result.isStale,
        cached: result.cached,
        fetchedAt: result.fetchedAt,
        statusMessage: result.statusMessage,
      });
    }

    return summaries;
  }
}
