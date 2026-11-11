import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Input } from '../common/Input.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';
import { useCompanySettings, ReportReminderSettings } from '../../utils/gst.js';

const DAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
  { n: 6, short: 'Sat' },
  { n: 0, short: 'Sun' },
];

const DEFAULTS: ReportReminderSettings = { enabled: true, reminderTime: '18:00', escalationTime: '20:00', workDays: [1, 2, 3, 4, 5, 6] };

/** "20:00" → "8:00 PM" */
const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** MD only: when In-Charges are reminded about a missing daily report, and when the MD is told. */
export const ReportRemindersCard: React.FC = () => {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useCompanySettings();
  const [form, setForm] = useState<ReportReminderSettings>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.reportReminders) setForm(data.reportReminders);
  }, [data]);

  const toggleDay = (n: number) =>
    setForm((f) => ({ ...f, workDays: f.workDays.includes(n) ? f.workDays.filter((d) => d !== n) : [...f.workDays, n] }));

  const orderError =
    form.reminderTime && form.escalationTime && form.escalationTime <= form.reminderTime
      ? 'Must be later than the In-Charge reminder'
      : undefined;

  const save = async () => {
    if (orderError) return;
    if (form.workDays.length === 0) {
      toastError('Choose at least one work day');
      return;
    }
    setSaving(true);
    try {
      await api.put('/company-settings/report-reminders', form);
      await queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      success('Report reminders saved');
    } catch (err: any) {
      toastError(err.message || 'Could not save report reminders');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="w-4 h-4 text-navy-800" />
          <CardTitle>Daily report reminders</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600">
          If a site has no daily report, its Site In-Charge gets a phone reminder. If there is still none later, you get one
          alert listing every site that hasn&apos;t reported. Times are India time.
        </p>

        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-5 h-5 accent-navy-900"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            disabled={isLoading}
          />
          <span className="text-sm font-semibold text-slate-800">Send report reminders</span>
        </label>

        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${form.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <Input
            label="Remind the In-Charge at"
            type="time"
            value={form.reminderTime}
            onChange={(e) => setForm((f) => ({ ...f, reminderTime: e.target.value }))}
            helperText={form.reminderTime ? `“Daily report due” at ${time12(form.reminderTime)}` : undefined}
            disabled={isLoading || !form.enabled}
          />
          <Input
            label="Alert me (MD) at"
            type="time"
            value={form.escalationTime}
            onChange={(e) => setForm((f) => ({ ...f, escalationTime: e.target.value }))}
            error={orderError}
            helperText={!orderError && form.escalationTime ? `Sites still missing at ${time12(form.escalationTime)}` : undefined}
            disabled={isLoading || !form.enabled}
          />
        </div>

        <fieldset className={form.enabled ? '' : 'opacity-50 pointer-events-none'} disabled={isLoading || !form.enabled}>
          <legend className="text-sm font-semibold text-slate-800 mb-2">Work days (no reminders on other days)</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = form.workDays.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d.n)}
                  className={`min-w-[52px] min-h-[40px] px-3 rounded-xl text-sm font-semibold border transition-colors ${
                    on ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <Button onClick={save} isLoading={saving} disabled={isLoading || Boolean(orderError)}>
            Save reminders
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
