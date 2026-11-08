import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Send } from 'lucide-react';
import { useToast } from '../../context/ToastContext.js';
import { disablePush, enablePush, getPushState, PushState, sendTestPush } from '../../utils/push.js';

const TEXT: Record<PushState, string> = {
  on: 'On for this device. New messages, payment requests, reports and approvals arrive even when the website is closed.',
  off: 'Off for this device. Turn on to get notified when the website is closed.',
  denied: 'Blocked in the browser. Open the site settings (lock icon next to the address) → Notifications → Allow, then reload.',
  'ios-needs-install': 'On iPhone, first tap Share → “Add to Home Screen”, then open BKR INFRA from the home-screen icon and turn this on.',
  unsupported: 'This browser cannot show notifications. Use Chrome, Edge, Firefox or Safari (installed to the home screen).',
};

/** Per-device switch for phone / computer notifications, with a test button. */
export const PushSettingsCard: React.FC = () => {
  const { success, error, showToast } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  const toggle = async () => {
    setBusy('toggle');
    try {
      if (state === 'on') {
        await disablePush();
        setState('off');
        showToast('Notifications turned off on this device', 'info');
      } else {
        const next = await enablePush();
        setState(next);
        if (next === 'on') success('Notifications are on for this device');
      }
    } catch (err: any) {
      error(err.message || 'Could not change notification settings');
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      showToast(await sendTestPush(), 'info');
    } catch (err: any) {
      error(err.message || 'Could not send a test');
    } finally {
      setBusy('');
    }
  };

  if (!state) return null;
  const on = state === 'on';
  const canToggle = state === 'on' || state === 'off';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
        {on ? <BellRing className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-navy-950">Phone &amp; computer notifications</h3>
        <p className="text-xs text-slate-600 mt-0.5">{TEXT[state]}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        {on && (
          <button
            onClick={test}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-300 text-xs font-bold text-navy-900 hover:bg-slate-50 disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5" /> {busy === 'test' ? 'Sending…' : 'Send test'}
          </button>
        )}
        {canToggle && (
          <button
            role="switch"
            aria-checked={on}
            onClick={toggle}
            disabled={Boolean(busy)}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold disabled:opacity-60 ${
              on ? 'bg-slate-200 text-slate-800 hover:bg-slate-300' : 'bg-amber-500 text-navy-950 hover:bg-amber-400'
            }`}
          >
            {busy === 'toggle' ? 'Please wait…' : on ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
    </div>
  );
};
