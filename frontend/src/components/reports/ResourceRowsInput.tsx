import React, { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { MaterialItem, MachineryItem } from '../../types/index.js';
import { UNIT_OPTIONS, MATERIAL_SUGGESTIONS, MACHINERY_SUGGESTIONS } from '../../utils/reportOptions.js';

const RowShell: React.FC<{ onRemove: () => void; label: string; children: React.ReactNode }> = ({ onRemove, label, children }) => (
  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-2">
    <div className="flex-1 min-w-0 space-y-2">{children}</div>
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 shrink-0"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </div>
);

export const MaterialsInput: React.FC<{ items: MaterialItem[]; onChange: (items: MaterialItem[]) => void }> = ({ items, onChange }) => {
  const listId = useId();
  const update = (i: number, patch: Partial<MaterialItem>) => onChange(items.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy-950">Materials used</h3>
          <p className="text-xs text-slate-500">Quantities consumed on site today.</p>
        </div>
        <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="w-4 h-4" />} onClick={() => onChange([...items, { name: '', quantity: 0, unit: 'bags' }])}>
          Add material
        </Button>
      </div>
      <datalist id={listId}>
        {MATERIAL_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">No materials recorded.</p>
      ) : (
        items.map((m, i) => (
          <RowShell key={i} label={m.name || `material ${i + 1}`} onRemove={() => onChange(items.filter((_, idx) => idx !== i))}>
            <Input list={listId} aria-label="Material name" placeholder="Material (e.g. Cement OPC 53)" maxLength={150} value={m.name} onChange={(e) => update(i, { name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" inputMode="decimal" min="0" step="any" aria-label="Material quantity" placeholder="Qty" value={m.quantity || ''} onChange={(e) => update(i, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })} />
              <Select aria-label="Material unit" value={m.unit} onChange={(e) => update(i, { unit: e.target.value })} options={(UNIT_OPTIONS.includes(m.unit) ? UNIT_OPTIONS : [m.unit, ...UNIT_OPTIONS]).map((u) => ({ value: u, label: u }))} />
            </div>
          </RowShell>
        ))
      )}
    </div>
  );
};

export const MachineryInput: React.FC<{ items: MachineryItem[]; onChange: (items: MachineryItem[]) => void }> = ({ items, onChange }) => {
  const listId = useId();
  const update = (i: number, patch: Partial<MachineryItem>) => onChange(items.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy-950">Machinery &amp; equipment</h3>
          <p className="text-xs text-slate-500">Machines deployed and hours each ran.</p>
        </div>
        <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="w-4 h-4" />} onClick={() => onChange([...items, { name: '', quantity: 1, hoursUsed: 8 }])}>
          Add machine
        </Button>
      </div>
      <datalist id={listId}>
        {MACHINERY_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">No machinery recorded.</p>
      ) : (
        items.map((m, i) => (
          <RowShell key={i} label={m.name || `machine ${i + 1}`} onRemove={() => onChange(items.filter((_, idx) => idx !== i))}>
            <Input list={listId} aria-label="Machine name" placeholder="Machine (e.g. JCB / Backhoe)" maxLength={150} value={m.name} onChange={(e) => update(i, { name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" inputMode="numeric" min="1" aria-label="Number of machines" placeholder="Nos" leftIcon={<span className="text-[11px] font-bold text-slate-500">×</span>} value={m.quantity || ''} onChange={(e) => update(i, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} />
              <Input type="number" inputMode="decimal" min="0" max="24" step="0.5" aria-label="Hours used" placeholder="Hours" rightIcon={<span className="text-[11px] text-slate-500">hrs</span>} value={m.hoursUsed ?? ''} onChange={(e) => update(i, { hoursUsed: e.target.value === '' ? undefined : Math.min(24, Math.max(0, parseFloat(e.target.value) || 0)) })} />
            </div>
          </RowShell>
        ))
      )}
    </div>
  );
};
