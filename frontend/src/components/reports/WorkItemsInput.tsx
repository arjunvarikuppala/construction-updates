import React from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { WorkItem } from '../../types/index.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { formatRupees } from '../../utils/currency.js';
import { UNIT_OPTIONS } from '../../utils/reportOptions.js';

interface WorkItemsInputProps {
  items: WorkItem[];
  onChange: (items: WorkItem[]) => void;
  defaultLocation?: string;
}

export const emptyWorkItem = (location = ''): WorkItem => ({
  description: '',
  quantity: 0,
  unit: 'sq.m',
  budget: 0,
  location,
});

/** Multiple measured work items per report (no one-item-per-day restriction). */
export const WorkItemsInput: React.FC<WorkItemsInputProps> = ({ items, onChange, defaultLocation = '' }) => {
  const addItem = () => onChange([...items, emptyWorkItem(defaultLocation)]);
  const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index));
  const duplicateItem = (index: number) => {
    const copy = { ...items[index], quantity: 0 };
    onChange([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
  };
  const updateItem = (index: number, patch: Partial<WorkItem>) => {
    onChange(
      items.map((it, i) => {
        if (i !== index) return it;
        const next = { ...it, ...patch };
        // Rate per unit drives the amount: quantity × rate
        if (next.rate && next.rate > 0) next.budget = Math.round((Number(next.quantity) || 0) * next.rate * 100) / 100;
        return next;
      })
    );
  };

  const totalWorkBudget = items.reduce((sum, item) => sum + (Number(item.budget) || 0), 0);
  const filled = items.filter((i) => i.description.trim()).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-navy-950">Work items &amp; quantities</h3>
          <p className="text-xs text-slate-500">Add every task done today with its measured quantity. {filled > 0 && <span className="font-semibold text-slate-700">{filled} item{filled === 1 ? '' : 's'}</span>}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addItem} leftIcon={<Plus className="w-4 h-4" />}>
          Add item
        </Button>
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          onClick={addItem}
          className="w-full p-5 bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl text-center text-sm text-slate-500 hover:border-amber-400 hover:text-slate-700"
        >
          + Add the first work item (e.g. brickwork, slab casting, plastering)
        </button>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <fieldset key={index} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 min-w-0">
              <legend className="sr-only">Work item {index + 1}</legend>
              <div className="flex items-start gap-2">
                <span className="mt-2.5 w-6 h-6 shrink-0 rounded-full bg-navy-900 text-white text-[11px] font-bold flex items-center justify-center">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <Input
                    aria-label={`Work item ${index + 1} description`}
                    placeholder="What was done? e.g. 230mm brickwork"
                    value={item.description}
                    maxLength={300}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => duplicateItem(index)}
                  title="Duplicate item"
                  aria-label={`Duplicate work item ${index + 1}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-navy-800 rounded-lg hover:bg-slate-200 shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  title="Delete work item"
                  aria-label={`Delete work item ${index + 1}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  aria-label="Quantity"
                  placeholder="Quantity"
                  min="0"
                  step="any"
                  value={item.quantity ? item.quantity : ''}
                  onChange={(e) => updateItem(index, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })}
                />
                <Select
                  aria-label="Unit"
                  value={item.unit}
                  onChange={(e) => updateItem(index, { unit: e.target.value })}
                  options={(UNIT_OPTIONS.includes(item.unit) ? UNIT_OPTIONS : [item.unit, ...UNIT_OPTIONS]).map((u) => ({ value: u, label: u }))}
                />
                <div className="col-span-2 sm:col-span-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    aria-label={`Rate in rupees per ${item.unit}`}
                    placeholder="Rate"
                    className="!pr-16 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
                    rightIcon={<span className="text-[11px] text-slate-500 whitespace-nowrap">/ {item.unit}</span>}
                    value={!item.rate ? '' : item.rate}
                    onChange={(e) => {
                      const parsed = e.target.value === '' ? 0 : parseFloat(e.target.value);
                      const rate = isNaN(parsed) || parsed < 0 ? 0 : parsed;
                      updateItem(index, rate > 0 ? { rate } : { rate: undefined });
                    }}
                  />
                </div>
              </div>

              {!!item.rate && item.rate > 0 && (
                <p className="text-xs text-slate-600">
                  {item.quantity || 0} {item.unit} × {formatRupees(item.rate)} / {item.unit} ={' '}
                  <span className="font-bold text-emerald-700">{formatRupees(item.budget || 0)}</span>
                </p>
              )}
            </fieldset>
          ))}

          <div className="flex items-center justify-between gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={addItem} leftIcon={<Plus className="w-4 h-4" />}>
              Add another item
            </Button>
            {totalWorkBudget > 0 && (
              <span className="text-xs font-semibold text-slate-600">
                Total amount: <span className="text-emerald-700">{formatRupees(totalWorkBudget)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
