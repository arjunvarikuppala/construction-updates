import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { paiseToRupees } from '../../utils/currency.js';
import { ExpenditureTrendItem } from '../../types/index.js';

interface ExpenditureTrendChartProps {
  data: ExpenditureTrendItem[];
}

export const ExpenditureTrendChart: React.FC<ExpenditureTrendChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-slate-400 text-xs italic">
        No monthly expenditure trend data yet
      </div>
    );
  }

  const chartData = data.map((item) => ({
    name: item.label,
    'Approved (₹)': paiseToRupees(item.approved),
    'Pending (₹)': paiseToRupees(item.pending),
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-navy-950 text-white p-3 rounded-xl shadow-xl border border-navy-800 text-xs space-y-1">
          <p className="font-bold text-amber-400 mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={`trend-${index}`} className="flex items-center justify-between gap-4">
              <span className="text-slate-300">{entry.name}:</span>
              <span className="font-semibold text-white">
                ₹{Number(entry.value).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
          <defs>
            <linearGradient id="colorApproved" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="colorPending" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="5%" stopColor="#F5A623" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#F5A623" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#64748B', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
          />
          <YAxis
            tick={{ fill: '#64748B', fontSize: 11 }}
            tickFormatter={(val) => `₹${val >= 100000 ? `${(val / 100000).toFixed(0)}L` : val}`}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: 10, fontSize: 12 }}
            iconType="circle"
          />
          <Area
            type="monotone"
            dataKey="Approved (₹)"
            stroke="#10B981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorApproved)"
          />
          <Area
            type="monotone"
            dataKey="Pending (₹)"
            stroke="#F5A623"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorPending)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
