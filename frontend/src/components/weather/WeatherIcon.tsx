import React from 'react';
import {
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  CloudDrizzle,
  CloudFog,
  Snowflake,
  Wind,
  HelpCircle,
} from 'lucide-react';

interface WeatherIconProps {
  icon?: string;
  className?: string;
}

export const WeatherIcon: React.FC<WeatherIconProps> = ({ icon, className = 'w-6 h-6' }) => {
  switch (icon?.toLowerCase()) {
    case 'sunny':
      return <Sun className={`${className} text-amber-500`} />;
    case 'partly-cloudy':
      return <CloudSun className={`${className} text-amber-400`} />;
    case 'cloudy':
      return <Cloud className={`${className} text-slate-400`} />;
    case 'fog':
      return <CloudFog className={`${className} text-slate-400`} />;
    case 'drizzle':
      return <CloudDrizzle className={`${className} text-sky-400`} />;
    case 'rain':
    case 'rain-showers':
      return <CloudRain className={`${className} text-blue-500`} />;
    case 'thunderstorm':
      return <CloudLightning className={`${className} text-amber-600`} />;
    case 'snow':
      return <Snowflake className={`${className} text-sky-300`} />;
    case 'wind':
      return <Wind className={`${className} text-teal-500`} />;
    default:
      return <Sun className={`${className} text-amber-500`} />;
  }
};
