import React from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { LabourCountItem } from '../../types/index.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';

interface LabourBreakdownInputProps {
  labourList: LabourCountItem[];
  onChange: (list: LabourCountItem[]) => void;
}

const COMMON_ROLES = [
  'Mason',
  'Helper / Unskilled',
  'Bar Bender',
  'Carpenter / Shuttering',
  'Plumber',
  'Electrician',
  'Painter',
  'Welder',
  'Machine Operator',
  'Site Supervisor',
  'Other',
];

export const LabourBreakdownInput: React.FC<LabourBreakdownInputProps> = ({
  labourList,
  onChange,
}) => {
  const addLabour = () => {
    onChange([...labourList, { role: 'Mason', count: 0 }]);
  };

  const removeLabour = (index: number) => {
    onChange(labourList.filter((_, i) => i !== index));
  };

  const updateLabour = (index: number, field: keyof LabourCountItem, value: any) => {
    const updated = [...labourList];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const totalHeadcount = labourList.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Site Labour & Headcount
          </label>
          <p className="text-[11px] text-slate-500">Breakdown of trades and helpers active on site.</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-300 rounded-lg text-xs font-bold text-amber-900">
            <Users className="w-3.5 h-3.5 text-amber-600" />
            <span>Total: {totalHeadcount}</span>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addLabour}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Add Trade
          </Button>
        </div>
      </div>

      {labourList.length === 0 ? (
        <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-500">
          No labour recorded. Add mason, carpenter, or helper headcounts.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {labourList.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200"
            >
              <div className="flex-1">
                <Select
                  value={item.role}
                  onChange={(e) => updateLabour(index, 'role', e.target.value)}
                  options={COMMON_ROLES.map((r) => ({ value: r, label: r }))}
                />
              </div>

              <div className="w-24">
                <Input
                  type="number"
                  min="0"
                  placeholder="Count"
                  value={item.count || ''}
                  onChange={(e) => updateLabour(index, 'count', parseInt(e.target.value) || 0)}
                  required
                />
              </div>

              <button
                type="button"
                onClick={() => removeLabour(index)}
                className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
