import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { paiseToRupees } from '../../utils/currency.js';
import { CategoryBreakdownItem } from '../../types/index.js';

interface CategoryExpensePieChartProps {
  data: CategoryBreakdownItem[];
}

const CATEGORY_COLORS: Record<string, string> = {
  LABOUR: '#F5A623', // Construction Amber
  CONSTRUCTION_MATERIALS: '#142B4A', // Deep Navy
  DIESEL_AND_FUEL: '#EF4444', // Red
  MACHINERY_AND_EQUIPMENT: '#0284C7', // Sky Blue
  TRANSPORTATION: '#8B5CF6', // Purple
  FOOD_AND_ACCOMMODATION: '#10B981', // Emerald
  REPAIRS_AND_MAINTENANCE: '#F97316', // Orange
  OTHER: '#64748B', // Slate
};

export const CategoryExpensePieChart: React.FC<CategoryExpensePieChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-slate-400 text-xs italic">
        No category expenditure recorded yet
      </div>
    );
  }

  const chartData = data.map((item) => ({
    name: item.category.replace(/_/g, ' '),
    rawCategory: item.category,
    value: paiseToRupees(item.amount),
    count: item.count,
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dataItem = payload[0];
      return (
        <div className="bg-navy-950 text-white p-3 rounded-xl shadow-xl border border-navy-800 text-xs">
          <p className="font-bold text-amber-400 mb-1">{dataItem.name}</p>
          <p className="text-white font-semibold">
            ₹{Number(dataItem.value).toLocaleString('en-IN')}
          </p>
          <p className="text-slate-400 text-[10px] mt-0.5">{dataItem.payload.count} expenses verified</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CATEGORY_COLORS[entry.rawCategory] || '#94A3B8'}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            layout="horizontal"
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};
