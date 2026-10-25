import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { WorkItem } from '../../types/index.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';

interface WorkItemsInputProps {
  items: WorkItem[];
  onChange: (items: WorkItem[]) => void;
}

const COMMON_UNITS = [
  'sq.m',
  'sq.ft',
  'cu.m',
  'Tons',
  'meters',
  'bags',
  'units',
  'trips',
  'hours',
];

export const WorkItemsInput: React.FC<WorkItemsInputProps> = ({ items, onChange }) => {
  const addItem = () => {
    onChange([...items, { description: '', quantity: 0, unit: 'sq.m' }]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof WorkItem, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Work Completed & Quantities
          </label>
          <p className="text-[11px] text-slate-500">Record specific measured tasks executed on site today.</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addItem}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          Add Work Item
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-500">
          No work items added yet. Click &quot;Add Work Item&quot; to log concrete poured, rebar tied, brickwork, etc.
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200"
            >
              <div className="flex-1">
                <Input
                  placeholder="Task Description (e.g. Slab Rebar Tied)"
                  value={item.description}
                  onChange={(e) => updateItem(index, 'description', e.target.value)}
                  required
                />
              </div>

              <div className="w-full sm:w-28">
                <Input
                  type="number"
                  placeholder="Qty"
                  step="0.01"
                  value={item.quantity || ''}
                  onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div className="w-full sm:w-32">
                <Select
                  value={item.unit}
                  onChange={(e) => updateItem(index, 'unit', e.target.value)}
                  options={COMMON_UNITS.map((u) => ({ value: u, label: u }))}
                />
              </div>

              <button
                type="button"
                onClick={() => removeItem(index)}
                className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 transition-colors self-end sm:self-center"
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
