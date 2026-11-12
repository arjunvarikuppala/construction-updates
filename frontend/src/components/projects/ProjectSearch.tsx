import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, X, ClipboardList, Wallet, HardHat, Boxes, Truck, Receipt, ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { formatDate } from '../../utils/dates.js';
import { inr } from '../../utils/payments.js';

type SearchType = 'work' | 'labour' | 'materials' | 'machinery' | 'payments' | 'expenses';
interface Result {
  type: SearchType;
  id: string;
  date: string;
  title: string;
  detail: string;
  amountPaise?: number;
  status?: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  link?: string;
}
interface Response {
  results: Result[];
  counts: Partial<Record<SearchType, number>>;
  total: number;
  truncated: boolean;
  summary: null | { paidPaise: number; duePaise: number; machineryPaise: number; labourPaise: number; materialsPaise: number; expensesPaise: number };
}

const TYPES: Array<{ key: SearchType; label: string; icon: React.ElementType }> = [
  { key: 'work', label: 'Work', icon: ClipboardList },
  { key: 'payments', label: 'Payments', icon: Wallet },
  { key: 'labour', label: 'Labour', icon: HardHat },
  { key: 'materials', label: 'Materials', icon: Boxes },
  { key: 'machinery', label: 'Machinery', icon: Truck },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
];
const STATUSES = [
  { key: 'WAITING', label: 'Waiting for MD' },
  { key: 'PART', label: 'Part paid' },
  { key: 'PAID', label: 'Paid' },
  { key: 'REJECTED', label: 'Rejected' },
];
const TONE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

/** Wrap each searched word in <mark> */
const Highlight: React.FC<{ text: string; words: string[] }> = ({ text, words }) => {
  if (!words.length || !text) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="bg-amber-200/70 text-inherit rounded px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
};

/** Search everything on one project: work, labour, materials, machinery, payments, expenses. */
export const ProjectSearch: React.FC<{ projectId: string }> = ({ projectId }) => {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<SearchType | ''>('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Search shortly after typing stops
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const active = q.length >= 2 || statuses.length > 0 || Boolean(from || to);
  const params = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(statuses.length ? { status: statuses.join(',') } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString();
  const { data, isFetching } = useQuery({
    queryKey: ['project-search', projectId, params],
    queryFn: () => api.get<Response>(`/projects/${projectId}/search?${params}`),
    enabled: active,
    staleTime: 15000,
  });

  const words = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const shown = (data?.results || []).filter((r) => !type || r.type === type);
  const allCount = Object.values(data?.counts || {}).reduce((s, n) => s + (n || 0), 0);
  const grouped = TYPES.map((t) => ({ ...t, rows: shown.filter((r) => r.type === t.key) })).filter((g) => g.rows.length);
  const clear = () => {
    setText('');
    setQ('');
    setType('');
    setStatuses([]);
    setFrom('');
    setTo('');
  };
  const sum = data?.summary;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
      <div className="flex flex-col lg:flex-row gap-2">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search this project</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search work, payments, labour, machines, expenses… (e.g. jcb, cement, UTR, 45600, 09-nov)"
            className="w-full h-11 pl-9 pr-10 rounded-xl border border-slate-300 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-navy-500/20 focus:border-navy-500 focus:bg-white"
          />
          {(text || active) && (
            <button type="button" onClick={clear} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          )}
        </label>
        <div className="flex gap-2">
          <label className="flex-1 lg:flex-none">
            <span className="sr-only">From date</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-full h-11 rounded-xl border border-slate-300 px-2 text-sm" title="From" />
          </label>
          <label className="flex-1 lg:flex-none">
            <span className="sr-only">To date</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-full h-11 rounded-xl border border-slate-300 px-2 text-sm" title="To" />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setType('')}
          className={`min-h-[34px] px-3 rounded-full border text-xs font-bold ${!type ? 'bg-navy-900 border-navy-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          All{active && data ? ` ${allCount}` : ''}
        </button>
        {TYPES.map((t) => {
          const n = data?.counts?.[t.key] || 0;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(type === t.key ? '' : t.key)}
              className={`inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-full border text-xs font-bold ${
                type === t.key ? 'bg-navy-900 border-navy-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              } ${active && data && !n ? 'opacity-50' : ''}`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
              {active && data ? ` ${n}` : ''}
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
        <span className="text-[11px] font-semibold text-slate-500">Payment status:</span>
        {STATUSES.map((s) => {
          const on = statuses.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatuses(on ? statuses.filter((x) => x !== s.key) : [...statuses, s.key])}
              className={`min-h-[30px] px-2.5 rounded-full border text-[11px] font-bold ${on ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="border-t border-slate-100 pt-2">
          {isFetching && !data ? (
            <p className="py-6 text-center text-sm text-slate-500">Searching…</p>
          ) : !shown.length ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No matches{q ? ` for “${q}”` : ''}. Try another word, a different date range or fewer filters.
            </p>
          ) : (
            <div className="max-h-[520px] overflow-y-auto pr-1 -mr-1">
              {grouped.map((g) => {
                const Icon = g.icon;
                return (
                  <section key={g.key} className="mt-2 first:mt-0">
                    <h4 className="sticky top-0 z-10 bg-white py-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <Icon className="w-3.5 h-3.5" /> {g.label} · {g.rows.length}
                    </h4>
                    <ul className="divide-y divide-slate-100">
                      {g.rows.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            disabled={!r.link}
                            onClick={() => r.link && navigate(r.link)}
                            className="w-full grid grid-cols-[84px_minmax(0,1fr)_auto] sm:grid-cols-[110px_minmax(0,1fr)_auto] gap-3 items-start py-2.5 px-1 text-left rounded-lg hover:bg-slate-50 disabled:hover:bg-transparent"
                          >
                            <span className="text-xs text-slate-500 pt-0.5">{formatDate(r.date, 'dd MMM (EEE)')}</span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-navy-950 break-words">
                                <Highlight text={r.title} words={words} />
                              </span>
                              {r.detail && (
                                <span className="block text-xs text-slate-500 break-words">
                                  <Highlight text={r.detail} words={words} />
                                </span>
                              )}
                            </span>
                            <span className="flex items-start gap-1 text-right">
                              <span className="space-y-1">
                                {!!r.amountPaise && <span className="block text-sm font-bold text-navy-950 whitespace-nowrap">{inr(r.amountPaise)}</span>}
                                {r.status && (
                                  <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${TONE[r.tone || 'neutral']}`}>{r.status}</span>
                                )}
                              </span>
                              {r.link && <ChevronRight className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {!!shown.length && (
            <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
              <span>
                {shown.length}
                {data?.truncated ? '+' : ''} result{shown.length === 1 ? '' : 's'}
                {q ? ` for “${q}”` : ''}
                {from || to ? ` · ${from ? formatDate(from, 'dd MMM') : 'start'} to ${to ? formatDate(to, 'dd MMM') : 'today'}` : ''} · tap a row to open it
              </span>
              {sum && (
                <span className="font-semibold text-slate-700">
                  {[
                    sum.paidPaise ? `Paid ${inr(sum.paidPaise)}` : '',
                    sum.duePaise ? `due ${inr(sum.duePaise)}` : '',
                    sum.labourPaise ? `labour ${inr(sum.labourPaise)}` : '',
                    sum.materialsPaise ? `materials ${inr(sum.materialsPaise)}` : '',
                    sum.machineryPaise ? `machine cost ${inr(sum.machineryPaise)}` : '',
                    sum.expensesPaise ? `expenses ${inr(sum.expensesPaise)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
