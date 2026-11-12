import React, { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { MaterialItem, MachineryItem } from '../../types/index.js';
import { UNIT_OPTIONS, MATERIAL_SUGGESTIONS, MACHINERY_SUGGESTIONS, materialCost, machineCost } from '../../utils/reportOptions.js';
import { formatRupees } from '../../utils/currency.js';
import { MoreDetails, DetailField, numOrUndef, textOrUndef } from './MoreDetails.js';

const NO_SPIN = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const parseRate = (v: string) => {
  const n = parseFloat(v);
  return v === '' || isNaN(n) || n <= 0 ? undefined : n;
};

const CostChip: React.FC<{ total: number; suffix?: string }> = ({ total, suffix = '' }) =>
  total > 0 ? (
    <span className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-bold text-emerald-800">
      {formatRupees(total)}
      {suffix}
    </span>
  ) : null;

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
  const total = items.reduce((s, m) => s + materialCost(m), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy-950">Materials used</h3>
          <p className="text-xs text-slate-500">Quantities consumed on site today, with rate per unit.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <CostChip total={total} />
        <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="w-4 h-4" />} onClick={() => onChange([...items, { name: '', quantity: 0, unit: 'bags' }])}>
          Add material
        </Button>
        </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Input type="number" inputMode="decimal" min="0" step="any" aria-label="Material quantity used" placeholder="Qty used" value={m.quantity || ''} onChange={(e) => update(i, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })} />
              <Select aria-label="Material unit" value={m.unit} onChange={(e) => update(i, { unit: e.target.value })} options={(UNIT_OPTIONS.includes(m.unit) ? UNIT_OPTIONS : [m.unit, ...UNIT_OPTIONS]).map((u) => ({ value: u, label: u }))} />
              <div className="col-span-2 sm:col-span-1">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  aria-label={`Rate in rupees per ${m.unit}`}
                  placeholder="Rate"
                  className={`!pr-16 ${NO_SPIN}`}
                  leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
                  rightIcon={<span className="text-[11px] text-slate-500 whitespace-nowrap">/ {m.unit}</span>}
                  value={m.rate ?? ''}
                  onChange={(e) => update(i, { rate: parseRate(e.target.value) })}
                />
              </div>
            </div>
            {!!m.rate && m.quantity > 0 && (
              <p className="text-xs text-slate-600">
                {m.quantity} {m.unit} × {formatRupees(m.rate)} = <span className="font-bold text-emerald-700">{formatRupees(materialCost(m))}</span>
              </p>
            )}
            <MoreDetails
              filled={Boolean(m.received || m.supplier || m.spec || m.usedFor)}
              summary={[m.received ? `received ${m.received} ${m.unit}` : '', m.supplier].filter(Boolean).join(' · ')}
            >
              <DetailField label={`Received today (${m.unit})`} type="number" value={m.received} onChange={(v) => update(i, { received: numOrUndef(v) })} />
              <DetailField label="Supplier" maxLength={150} value={m.supplier} onChange={(v) => update(i, { supplier: textOrUndef(v) })} />
              <DetailField label="Bill no." maxLength={60} value={m.billNo} onChange={(v) => update(i, { billNo: textOrUndef(v) })} />
              <DetailField label="Specification" maxLength={150} placeholder="e.g. OPC 53 grade" value={m.spec} onChange={(v) => update(i, { spec: textOrUndef(v) })} />
              <DetailField label="Used for" wide maxLength={200} placeholder="e.g. PCC below footings" value={m.usedFor} onChange={(v) => update(i, { usedFor: textOrUndef(v) })} />
            </MoreDetails>
          </RowShell>
        ))
      )}
    </div>
  );
};

export const MachineryInput: React.FC<{ items: MachineryItem[]; onChange: (items: MachineryItem[]) => void }> = ({ items, onChange }) => {
  const listId = useId();
  const update = (i: number, patch: Partial<MachineryItem>) => onChange(items.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const total = items.reduce((s, m) => s + machineCost(m), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy-950">Machinery &amp; equipment</h3>
          <p className="text-xs text-slate-500">Machines deployed, hours each ran, and hire rate per day or per hour.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <CostChip total={total} />
        <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="w-4 h-4" />} onClick={() => onChange([...items, { name: '', quantity: 1, hoursUsed: 8 }])}>
          Add machine
        </Button>
        </div>
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
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                aria-label={`Hire rate in rupees per ${m.rateBasis === 'HOUR' ? 'hour' : m.rateBasis === 'TRIP' ? 'trip' : 'day'}`}
                placeholder="Rate"
                className={NO_SPIN}
                leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
                value={m.rate ?? ''}
                onChange={(e) => update(i, { rate: parseRate(e.target.value) })}
              />
              <Select
                aria-label="Rate basis"
                value={m.rateBasis || 'DAY'}
                onChange={(e) => update(i, { rateBasis: e.target.value as 'DAY' | 'HOUR' | 'TRIP' })}
                options={[
                  { value: 'DAY', label: 'per day' },
                  { value: 'HOUR', label: 'per hour' },
                  { value: 'TRIP', label: 'per trip' },
                ]}
              />
            </div>
            {(!!m.rate || !!m.dieselLitres || !!m.bata) && (
              <p className="text-xs text-slate-600">
                {m.rateBasis === 'TRIP'
                  ? `${m.trips || 0} trips × ${formatRupees(m.rate || 0)}`
                  : `${m.quantity} × ${m.rateBasis === 'HOUR' ? `${m.hoursUsed || 0} hrs × ${formatRupees(m.rate || 0)}/hr` : `${formatRupees(m.rate || 0)}/day`}`}
                {!!m.dieselLitres && ` + diesel ${m.dieselLitres} L × ${formatRupees(m.dieselRate || 0)}`}
                {!!m.bata && ` + bata ${formatRupees(m.bata)}`} ={' '}
                <span className="font-bold text-emerald-700">{formatRupees(machineCost(m))}</span>
                {m.rateBasis === 'HOUR' && !m.hoursUsed && <span className="text-amber-700"> (enter hours)</span>}
                {m.rateBasis === 'TRIP' && !m.trips && <span className="text-amber-700"> (enter trips in More details)</span>}
              </p>
            )}
            <MoreDetails
              filled={Boolean(m.model || m.regNo || m.operator || m.dieselLitres || m.trips || m.workDone)}
              summary={[m.model, m.regNo, m.operator].filter(Boolean).join(' · ') || 'added'}
            >
              <DetailField label="Make / model" maxLength={120} placeholder="e.g. JCB 3DX" value={m.model} onChange={(v) => update(i, { model: textOrUndef(v) })} />
              <DetailField label="Reg. / ID no." maxLength={40} placeholder="e.g. TS 08 EK 4417" value={m.regNo} onChange={(v) => update(i, { regNo: textOrUndef(v) })} />
              <label className="block min-w-0">
                <span className="block text-[11px] font-semibold text-slate-500 mb-0.5">Own / hired</span>
                <select
                  value={m.ownership || ''}
                  onChange={(e) => update(i, { ownership: (e.target.value || undefined) as MachineryItem['ownership'] })}
                  className="w-full h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                >
                  <option value="">—</option>
                  <option value="HIRED">Hired</option>
                  <option value="OWN">Own</option>
                </select>
              </label>
              <DetailField label="Owner / supplier" maxLength={150} value={m.supplier} onChange={(v) => update(i, { supplier: textOrUndef(v) })} />
              <DetailField label="Operator" maxLength={80} value={m.operator} onChange={(v) => update(i, { operator: textOrUndef(v) })} />
              <DetailField label="Trips" type="number" value={m.trips} onChange={(v) => update(i, { trips: numOrUndef(v) })} />
              <DetailField label="Start time" type="time" value={m.startTime} onChange={(v) => update(i, { startTime: textOrUndef(v) })} />
              <DetailField label="End time" type="time" value={m.endTime} onChange={(v) => update(i, { endTime: textOrUndef(v) })} />
              <DetailField label="Idle / breakdown hrs" type="number" value={m.idleHours} onChange={(v) => update(i, { idleHours: numOrUndef(v) })} />
              <DetailField
                label="Hour meter start"
                type="number"
                value={m.meterStart}
                onChange={(v) => {
                  const meterStart = numOrUndef(v);
                  const hrs = meterStart !== undefined && m.meterEnd !== undefined && m.meterEnd >= meterStart ? Math.min(24, Math.round((m.meterEnd - meterStart) * 100) / 100) : m.hoursUsed;
                  update(i, { meterStart, hoursUsed: hrs });
                }}
              />
              <DetailField
                label="Hour meter end"
                type="number"
                value={m.meterEnd}
                onChange={(v) => {
                  const meterEnd = numOrUndef(v);
                  const hrs = meterEnd !== undefined && m.meterStart !== undefined && meterEnd >= m.meterStart ? Math.min(24, Math.round((meterEnd - m.meterStart) * 100) / 100) : m.hoursUsed;
                  update(i, { meterEnd, hoursUsed: hrs });
                }}
              />
              <DetailField label="Diesel (litres)" type="number" value={m.dieselLitres} onChange={(v) => update(i, { dieselLitres: numOrUndef(v) })} />
              <DetailField label="Diesel rate / litre" type="number" prefix="₹" value={m.dieselRate} onChange={(v) => update(i, { dieselRate: numOrUndef(v) })} />
              <DetailField label="Operator bata" type="number" prefix="₹" value={m.bata} onChange={(v) => update(i, { bata: numOrUndef(v) })} />
              <DetailField label="Work done" wide maxLength={300} placeholder="e.g. Footing excavation grids A1–C4" value={m.workDone} onChange={(v) => update(i, { workDone: textOrUndef(v) })} />
              <DetailField label="Work quantity" type="number" value={m.workQty} onChange={(v) => update(i, { workQty: numOrUndef(v) })} />
              <DetailField label="Work unit" maxLength={30} placeholder="e.g. cum" value={m.workUnit} onChange={(v) => update(i, { workUnit: textOrUndef(v) })} />
            </MoreDetails>
          </RowShell>
        ))
      )}
    </div>
  );
};
