import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { paiseToRupees } from '../../utils/currency.js';

interface ProjectBudgetBarChartProps {
  data: Array<{
    name: string;
    code: string;
    budget: number; // in paise
    approved: number; // in paise
    pending: number; // in paise
  }>;
}

export const ProjectBudgetBarChart: React.FC<ProjectBudgetBarChartProps> = ({ data }) => {
  const chartData = data.map((item) => ({
    name: item.code || item.name,
    fullName: item.name,
    'Budget (₹)': paiseToRupees(item.budget),
    'Approved (₹)': paiseToRupees(item.approved),
    'Pending (₹)': paiseToRupees(item.pending),
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-navy-950 text-white p-3 rounded-xl shadow-xl border border-navy-800 text-xs space-y-1">
          <p className="font-bold text-amber-400 mb-1">{payload[0]?.payload?.fullName || label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center justify-between gap-4">
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
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
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
          <Bar dataKey="Budget (₹)" fill="#142B4A" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="Approved (₹)" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="Pending (₹)" fill="#F5A623" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
