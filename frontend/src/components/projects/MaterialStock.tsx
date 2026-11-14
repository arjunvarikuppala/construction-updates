/**
 * Project → Materials tab: what is on site now, and every change to it (the material log).
 *
 * - The MD and the in-charge can both add stock, record use outside a daily report,
 *   or correct the count after a physical check.
 * - Daily reports take "used" quantities off automatically (and add "received" ones).
 * - The MD sets a low-stock level per material.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, ArrowDownCircle, ArrowUpCircle, Scale, Trash2, FileText, BellRing } from 'lucide-react';
import { Card, CardContent } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { Modal } from '../common/Modal.js';
import { LoadingSkeleton } from '../common/LoadingSkeleton.js';
import { api, ApiError } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { useToast } from '../../context/ToastContext.js';
import { formatDate, localDateString } from '../../utils/dates.js';
import { UNIT_OPTIONS, MATERIAL_SUGGESTIONS } from '../../utils/reportOptions.js';
import { MaterialStockResponse, MaterialLogRow, MaterialStockRow, formatQty } from '../../utils/materialStock.js';

type EntryType = 'IN' | 'OUT' | 'ADJUST';

const TYPE_OPTIONS: Array<{ value: EntryType; label: string; icon: React.ElementType }> = [
  { value: 'IN', label: 'Stock added', icon: ArrowDownCircle },
  { value: 'OUT', label: 'Used', icon: ArrowUpCircle },
  { value: 'ADJUST', label: 'Correct count', icon: Scale },
];

const NEW_MATERIAL = '__new__';

function describe(e: MaterialLogRow): string {
  if (e.source === 'REPORT') {
    return `${e.change > 0 ? 'Received' : 'Used'} · Daily report${e.reportTitle ? `: ${e.reportTitle}` : ''}`;
  }
  if (e.type === 'IN') return ['Stock added', e.supplier, e.billNo ? `bill ${e.billNo}` : ''].filter(Boolean).join(' · ');
  if (e.type === 'OUT') return 'Used (not in a report)';
  return 'Count corrected';
}

export const MaterialStock: React.FC<{ projectId: string }> = ({ projectId }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isOwner, isMD } = useAuth();
  const isMDOrOwner = isOwner || isMD;
  const myId = user?.id || user?._id;
  const toast = useToast();

  const [filter, setFilter] = useState('');
  const [entryOpen, setEntryOpen] = useState<null | { type: EntryType; materialId?: string }>(null);
  const [lowFor, setLowFor] = useState<MaterialStockRow | null>(null);

  const stockQuery = useQuery({
    queryKey: ['material-stock', projectId],
    queryFn: () => api.get<MaterialStockResponse>(`/projects/${projectId}/materials`),
    refetchInterval: 30000,
  });
  const logQuery = useQuery({
    queryKey: ['material-log', projectId, filter],
    queryFn: () =>
      api.get<{ total: number; entries: MaterialLogRow[] }>(
        `/projects/${projectId}/materials/log${filter ? `?materialId=${filter}` : ''}`
      ),
    refetchInterval: 30000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['material-stock', projectId] });
    queryClient.invalidateQueries({ queryKey: ['material-log', projectId] });
  };

  const remove = useMutation({
    mutationFn: (entryId: string) => api.delete(`/projects/${projectId}/materials/entries/${entryId}`),
    onSuccess: () => {
      toast.success('Entry removed');
      refresh();
    },
    onError: (err: any) => toast.error(err instanceof ApiError ? err.message : 'Could not remove the entry'),
  });

  const materials = stockQuery.data?.materials || [];
  const entries = logQuery.data?.entries || [];
  const startDate = stockQuery.data?.startDate;
  const lowCount = materials.filter((m) => m.isLow).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-navy-950 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-navy-700" /> Material stock on site
              </h2>
              <p className="text-xs text-slate-500">
                Stock added minus what daily reports used
                {startDate ? `, counted from ${formatDate(startDate)}` : ''}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" leftIcon={<Scale className="w-4 h-4" />} onClick={() => setEntryOpen({ type: 'ADJUST' })} disabled={materials.length === 0}>
                Correct count
              </Button>
              <Button size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setEntryOpen({ type: 'IN' })}>
                Add stock
              </Button>
            </div>
          </div>

          {lowCount > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
              <BellRing className="w-4 h-4 shrink-0" />
              {lowCount === 1 ? '1 material is' : `${lowCount} materials are`} low or below zero. Order more or correct the count.
            </div>
          )}

          {stockQuery.isLoading ? (
            <LoadingSkeleton rows={2} height="h-20" />
          ) : materials.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-slate-300 rounded-xl">
              <p className="text-sm font-semibold text-navy-950">Add the stock on site to start</p>
              <p className="text-xs text-slate-500 mt-1">Sand, cement bags, bricks, steel. Daily reports then take off what's used.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {materials.map((m) => {
                const selected = filter === m._id;
                return (
                  <div
                    key={m._id}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      selected ? 'border-navy-700 bg-navy-50' : m.isLow ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => setFilter(selected ? '' : m._id)} aria-pressed={selected}>
                      <p className="text-xs font-semibold text-slate-600 truncate" title={m.name}>{m.name}</p>
                      <p className={`text-xl font-extrabold mt-0.5 ${m.balance < 0 ? 'text-rose-700' : 'text-navy-950'}`}>
                        {formatQty(m.balance)} <span className="text-xs font-semibold text-slate-500">{m.unit}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        In {formatQty(m.totalIn)} · Used {formatQty(m.totalOut)}
                      </p>
                    </button>
                    <div className="flex items-center justify-between gap-1 mt-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          m.isLow ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {m.balance < 0 ? 'Below zero' : m.isLow ? 'Low stock' : 'In stock'}
                      </span>
                      {isMDOrOwner && (
                        <button type="button" onClick={() => setLowFor(m)} className="text-[11px] font-semibold text-navy-700 hover:underline min-h-[28px]">
                          {m.lowStockLevel === null ? 'Set alert' : `Alert at ${formatQty(m.lowStockLevel)}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-navy-950">Material log</h2>
              <p className="text-xs text-slate-500">Every addition and use, newest first.</p>
            </div>
            {materials.length > 0 && (
              <div className="w-full sm:w-56">
                <Select
                  aria-label="Show material"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  options={[{ value: '', label: 'All materials' }, ...materials.map((m) => ({ value: m._id, label: `${m.name} (${m.unit})` }))]}
                />
              </div>
            )}
          </div>

          {logQuery.isLoading ? (
            <LoadingSkeleton rows={4} height="h-12" />
          ) : entries.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">No stock changes recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {entries.map((e) => {
                const canDelete = e.source === 'MANUAL' && (isMDOrOwner || e.createdBy?._id === myId);
                const plus = e.change > 0;
                return (
                  <li key={e._id} className="py-2.5 flex items-start gap-3">
                    <div className="w-14 shrink-0 text-[11px] font-semibold text-slate-500 pt-0.5">{formatDate(e.date, 'dd MMM')}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-navy-950">
                        {e.materialName}{' '}
                        <span className={`font-bold ${plus ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {plus ? '+' : '−'}
                          {formatQty(Math.abs(e.change))} {e.unit}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 break-words">
                        {e.source === 'REPORT' && e.reportId ? (
                          <button type="button" onClick={() => navigate(`/reports/${e.reportId}`)} className="inline-flex items-center gap-1 text-navy-700 hover:underline text-left">
                            <FileText className="w-3 h-3 shrink-0" />
                            {describe(e)}
                          </button>
                        ) : (
                          describe(e)
                        )}
                        {e.note ? ` · ${e.note}` : ''}
                        {e.createdBy ? ` · ${e.createdBy.name}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Balance</p>
                      <p className={`text-sm font-bold ${e.balanceAfter < 0 ? 'text-rose-700' : 'text-navy-950'}`}>{formatQty(e.balanceAfter)}</p>
                    </div>
                    {canDelete ? (
                      <button
                        type="button"
                        aria-label="Remove entry"
                        onClick={() => {
                          if (window.confirm(`Remove this entry (${plus ? '+' : '−'}${formatQty(Math.abs(e.change))} ${e.unit} ${e.materialName})? The stock will change back.`)) {
                            remove.mutate(e._id);
                          }
                        }}
                        className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="w-9 shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {logQuery.data && logQuery.data.total > entries.length && (
            <p className="text-[11px] text-slate-500 text-center">Showing the latest {entries.length} of {logQuery.data.total} entries.</p>
          )}
        </CardContent>
      </Card>

      {entryOpen && (
        <StockEntryModal
          projectId={projectId}
          materials={materials}
          initialType={entryOpen.type}
          initialMaterialId={entryOpen.materialId || (filter && materials.some((m) => m._id === filter) ? filter : undefined)}
          onClose={() => setEntryOpen(null)}
          onSaved={refresh}
        />
      )}
      {lowFor && <LowStockModal projectId={projectId} material={lowFor} onClose={() => setLowFor(null)} onSaved={refresh} />}
    </div>
  );
};

const StockEntryModal: React.FC<{
  projectId: string;
  materials: MaterialStockRow[];
  initialType: EntryType;
  initialMaterialId?: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ projectId, materials, initialType, initialMaterialId, onClose, onSaved }) => {
  const toast = useToast();
  const [type, setType] = useState<EntryType>(initialType);
  const [materialId, setMaterialId] = useState(initialMaterialId || (materials[0]?._id ?? NEW_MATERIAL));
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('bags');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(localDateString());
  const [supplier, setSupplier] = useState('');
  const [billNo, setBillNo] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const isNew = materialId === NEW_MATERIAL;
  const current = materials.find((m) => m._id === materialId);
  const shownUnit = isNew ? unit : current?.unit || '';
  const qty = parseFloat(quantity);
  const preview =
    current && Number.isFinite(qty)
      ? type === 'IN'
        ? current.balance + qty
        : type === 'OUT'
          ? current.balance - qty
          : qty
      : null;

  const save = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/materials/entries`, {
        type,
        ...(isNew ? { name, unit } : { materialId }),
        quantity: qty,
        date,
        supplier: supplier || undefined,
        billNo: billNo || undefined,
        rate: rate ? parseFloat(rate) : undefined,
        note: note || undefined,
      }),
    onSuccess: () => {
      toast.success(type === 'IN' ? 'Stock added' : type === 'OUT' ? 'Use recorded' : 'Count corrected');
      onSaved();
      onClose();
    },
    onError: (err: any) => setError(err instanceof ApiError ? err.message : 'Could not save. Check your connection and try again.'),
  });

  const submit = () => {
    if (isNew && !name.trim()) return setError('Enter the material name');
    if (!Number.isFinite(qty) || qty < 0 || (type !== 'ADJUST' && qty === 0)) {
      return setError(type === 'ADJUST' ? 'Enter the counted stock' : 'Enter a quantity above zero');
    }
    setError('');
    save.mutate();
  };

  const typeChoices = materials.length === 0 ? TYPE_OPTIONS.filter((t) => t.value === 'IN') : TYPE_OPTIONS;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={type === 'IN' ? 'Add stock' : type === 'OUT' ? 'Record material used' : 'Correct the count'}
      description={
        type === 'ADJUST'
          ? 'Enter what you counted on site. The difference is logged.'
          : type === 'OUT'
            ? "For use that isn't in a daily report, like material sent to another site."
            : 'Material delivered to the site.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={save.isPending}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl" role="radiogroup" aria-label="Entry type">
          {typeChoices.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={type === t.value}
              onClick={() => {
                setType(t.value);
                if (t.value !== 'IN' && isNew && materials[0]) setMaterialId(materials[0]._id);
              }}
              className={`flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-bold ${
                type === t.value ? 'bg-white text-navy-950 shadow-sm' : 'text-slate-600'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <Select
          label="Material"
          value={materialId}
          onChange={(e) => setMaterialId(e.target.value)}
          options={[
            ...materials.map((m) => ({ value: m._id, label: `${m.name} (${formatQty(m.balance)} ${m.unit} on site)` })),
            ...(type === 'IN' ? [{ value: NEW_MATERIAL, label: '+ New material' }] : []),
          ]}
        />

        {isNew && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Input label="Material name" list="stock-material-suggestions" placeholder="River sand" maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
              <datalist id="stock-material-suggestions">
                {MATERIAL_SUGGESTIONS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={UNIT_OPTIONS.map((u) => ({ value: u, label: u }))} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Input
            label={type === 'ADJUST' ? `Counted on site (${shownUnit})` : `Quantity (${shownUnit})`}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setError('');
            }}
          />
          <Input label="Date" type="date" max={localDateString()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {preview !== null && (
          <p className={`text-xs font-semibold ${preview < 0 ? 'text-rose-700' : 'text-slate-600'}`}>
            On site: {formatQty(current!.balance)} → {formatQty(preview)} {current!.unit}
          </p>
        )}

        {type === 'IN' && (
          <div className="grid grid-cols-2 gap-2">
            <Input label="Supplier (optional)" maxLength={150} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            <Input label="Bill no. (optional)" maxLength={60} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            <Input label={`Rate per ${shownUnit} (optional)`} type="number" inputMode="decimal" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        )}
        <Input label="Note (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
};

const LowStockModal: React.FC<{ projectId: string; material: MaterialStockRow; onClose: () => void; onSaved: () => void }> = ({
  projectId,
  material,
  onClose,
  onSaved,
}) => {
  const toast = useToast();
  const [value, setValue] = useState(material.lowStockLevel === null ? '' : String(material.lowStockLevel));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (lowStockLevel: number | null) => api.patch(`/projects/${projectId}/materials/${material._id}`, { lowStockLevel }),
    onSuccess: () => {
      toast.success('Low-stock alert saved');
      onSaved();
      onClose();
    },
    onError: (err: any) => setError(err instanceof ApiError ? err.message : 'Could not save'),
  });
  const n = useMemo(() => (value === '' ? null : parseFloat(value)), [value]);
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={`Low-stock alert · ${material.name}`}
      description={`Shows "Low stock" when ${material.name} drops to this level or below.`}
      footer={
        <div className="flex justify-end gap-2">
          {material.lowStockLevel !== null && (
            <Button variant="ghost" onClick={() => save.mutate(null)}>
              Turn off
            </Button>
          )}
          <Button
            onClick={() => {
              if (n === null || !Number.isFinite(n) || n < 0) return setError('Enter a level of zero or more');
              save.mutate(n);
            }}
            isLoading={save.isPending}
          >
            Save
          </Button>
        </div>
      }
    >
      <Input
        label={`Alert at (${material.unit})`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        error={error}
      />
    </Modal>
  );
};

/**
 * Short stock card with an "Add stock" button, for the project overview and the
 * in-charge home screen. Low materials come first.
 */
export const MaterialStockSummary: React.FC<{ projectId: string; onViewLog: () => void; compact?: boolean }> = ({
  projectId,
  onViewLog,
  compact = false,
}) => {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['material-stock', projectId],
    queryFn: () => api.get<MaterialStockResponse>(`/projects/${projectId}/materials`),
    enabled: Boolean(projectId),
    refetchInterval: 60000,
  });
  const materials = useMemo(
    () => [...(data?.materials || [])].sort((a, b) => Number(b.isLow) - Number(a.isLow) || a.name.localeCompare(b.name)),
    [data]
  );
  const lowCount = materials.filter((m) => m.isLow).length;
  const shown = materials.slice(0, compact ? 3 : 6);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['material-stock', projectId] });
    queryClient.invalidateQueries({ queryKey: ['material-log', projectId] });
  };

  return (
    <div className={compact ? 'bg-white rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-card space-y-3' : 'space-y-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm sm:text-base font-bold text-navy-950 flex items-center gap-2">
            <Boxes className="w-4 h-4 text-navy-700 shrink-0" /> {compact ? 'Site stock' : 'Material stock on site'}
          </h3>
          {lowCount > 0 && (
            <p className="text-xs font-semibold text-rose-700 flex items-center gap-1 mt-0.5">
              <BellRing className="w-3.5 h-3.5" /> {lowCount === 1 ? '1 material is' : `${lowCount} materials are`} low
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {materials.length > 0 && (
            <Button size="sm" variant="outline" onClick={onViewLog}>
              {compact ? 'See log' : 'View log'}
            </Button>
          )}
          <Button size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)} disabled={!projectId}>
            Add stock
          </Button>
        </div>
      </div>

      {isLoading ? (
        <LoadingSkeleton rows={1} height="h-14" />
      ) : materials.length === 0 ? (
        <p className="text-xs text-slate-500">Add the stock on site to start. Daily reports then take off what's used.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shown.map((m) => (
            <button
              key={m._id}
              type="button"
              onClick={onViewLog}
              className={`p-2.5 rounded-xl border text-left ${m.isLow ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-slate-50/60'}`}
            >
              <p className="text-[11px] font-semibold text-slate-600 truncate" title={m.name}>{m.name}</p>
              <p className={`text-base font-extrabold ${m.isLow ? 'text-rose-700' : 'text-navy-950'}`}>
                {formatQty(m.balance)} <span className="text-[11px] font-semibold text-slate-500">{m.unit}</span>
              </p>
              {m.isLow && <p className="text-[10px] font-bold text-rose-700">{m.balance < 0 ? 'Below zero' : 'Low stock'}</p>}
            </button>
          ))}
        </div>
      )}
      {materials.length > shown.length && (
        <button type="button" onClick={onViewLog} className="text-xs font-semibold text-navy-700 hover:underline">
          +{materials.length - shown.length} more
        </button>
      )}

      {adding && (
        <StockEntryModal projectId={projectId} materials={data?.materials || []} initialType="IN" onClose={() => setAdding(false)} onSaved={refresh} />
      )}
    </div>
  );
};
