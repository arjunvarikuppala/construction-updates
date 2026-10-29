import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { WorkItem } from '../../types/index.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { formatRupees } from '../../utils/currency.js';

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
    onChange([...items, { description: '', quantity: 0, unit: 'sq.m', budget: 0 }]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof WorkItem, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const totalWorkBudget = items.reduce((sum, item) => sum + (Number(item.budget) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Work Completed & Quantities
          </label>
          <p className="text-[11px] text-slate-500">Record specific measured tasks executed on site today with allocated work budgets.</p>
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
              className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:gap-2"
            >
              {/* Row 1 on mobile: Delete button + Task Description */}
              <div className="flex items-center gap-2 flex-1 sm:contents">
                {/* 1. Delete button on the far left */}
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  title="Delete work item"
                  aria-label="Delete work item"
                  className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 transition-colors shrink-0 sm:order-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                {/* 2. Task Description */}
                <div className="flex-1 sm:order-2">
                  <Input
                    placeholder="Task Description (e.g. Slab Rebar Tied)"
                    value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Row 2 on mobile: Quantity, Unit, and Budget */}
              <div className="grid grid-cols-2 xs:grid-cols-3 gap-2 sm:contents">
                {/* 3. Quantity */}
                <div className="w-full sm:w-28 sm:order-3">
                  <Input
                    type="number"
                    placeholder="Qty"
                    min="0"
                    step="0.01"
                    value={item.quantity === 0 && !item.description ? '' : item.quantity ?? ''}
                    onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    required
                  />
                </div>

                {/* 4. Unit dropdown */}
                <div className="w-full sm:w-32 sm:order-4">
                  <Select
                    value={item.unit}
                    onChange={(e) => updateItem(index, 'unit', e.target.value)}
                    options={COMMON_UNITS.map((u) => ({ value: u, label: u }))}
                  />
                </div>

                {/* 5. Budget (₹) */}
                <div className="col-span-2 xs:col-span-1 w-full sm:w-36 sm:order-5">
                  <Input
                    type="number"
                    placeholder="Budget (₹)"
                    min="0"
                    step="any"
                    aria-label="Work item budget in Indian Rupees"
                    leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
                    value={item.budget === undefined || item.budget === null || (item.budget === 0 && !item.description) ? '' : item.budget}
                    onChange={(e) => {
                      const val = e.target.value;
                      const parsed = val === '' ? 0 : parseFloat(val);
                      updateItem(index, 'budget', isNaN(parsed) || parsed < 0 ? 0 : parsed);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Section Summary: Total Work Budget */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 px-3 py-2.5 bg-slate-50/70 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500 text-[11px]">
              * Work budget represents task allocation (distinct from actual expenses / bills).
            </span>
            <div className="flex items-center gap-2 self-end sm:self-auto font-bold">
              <span className="text-slate-600 uppercase tracking-wider text-[11px]">Total Work Budget:</span>
              <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 text-sm">
                {formatRupees(totalWorkBudget)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
