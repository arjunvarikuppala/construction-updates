import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap, CheckCircle2, CircleDashed, Copy, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card.js';
import { api, API_ORIGIN } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.js';

interface ProviderStatus {
  enabled: boolean;
  mode: 'off' | 'test' | 'live';
  reason?: string;
  webhookConfigured: boolean;
  accountConfigured: boolean;
  accountNumberHint: string | null;
  webhookPath: string;
  webhookEvents: string[];
}

/** MD: is RazorpayX set up, and how to set it up. Never shows keys. */
export const RazorpayXSetupCard: React.FC = () => {
  const { success } = useToast();
  const [showSteps, setShowSteps] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['payout-provider-status'],
    queryFn: () => api.get<{ provider: ProviderStatus }>('/payments/provider-status').then((r) => r.provider),
  });

  const backendOrigin = API_ORIGIN || window.location.origin;
  const webhookUrl = `${backendOrigin}${data?.webhookPath || '/api/v1/payments/webhook'}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      success('Copied');
    } catch {
      /* clipboard blocked */
    }
  };

  const badge = !data
    ? null
    : data.enabled
    ? data.mode === 'live'
      ? { text: 'LIVE — real money', tone: 'bg-emerald-100 text-emerald-800' }
      : { text: 'TEST MODE', tone: 'bg-violet-100 text-violet-800' }
    : { text: 'Not set up', tone: 'bg-slate-200 text-slate-700' };

  const checks = data
    ? [
        { ok: data.enabled || data.mode !== 'off' || !/keys are not added/.test(data.reason || ''), label: 'API keys added on the server' },
        { ok: data.accountConfigured, label: `RazorpayX account number${data.accountNumberHint ? ` (${data.accountNumberHint})` : ''}` },
        { ok: data.webhookConfigured, label: 'Webhook secret (payout updates arrive automatically)' },
        { ok: data.enabled, label: data.mode === 'live' ? 'Live payouts switched on' : 'Payouts switched on' },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-navy-800" />
            <CardTitle>RazorpayX bank payouts</CardTitle>
          </div>
          {badge && <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badge.tone}`}>{badge.text}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-600">
          With RazorpayX you pay vendors and Site In-Charges straight from this website — UPI, IMPS, NEFT or RTGS — and the payment,
          UTR and any bank reversal are recorded automatically.
        </p>
        {isLoading ? (
          <p className="text-xs text-slate-500">Checking…</p>
        ) : (
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-xs">
                {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <CircleDashed className="w-4 h-4 text-slate-400" />}
                <span className={c.ok ? 'text-navy-950' : 'text-slate-500'}>{c.label}</span>
              </li>
            ))}
          </ul>
        )}
        {data?.reason && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2.5">{data.reason}</p>}

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
          <span className="block text-[11px] font-bold text-slate-500 uppercase">Webhook URL (paste in RazorpayX)</span>
          <div className="flex items-center gap-2">
            <code className="text-[11px] font-mono text-navy-900 break-all flex-1">{webhookUrl}</code>
            <button type="button" onClick={() => copy(webhookUrl)} aria-label="Copy webhook URL" className="p-2 rounded-lg hover:bg-white text-slate-600">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>

        <button type="button" onClick={() => setShowSteps((v) => !v)} className="text-xs font-bold text-navy-800 underline underline-offset-2">
          {showSteps ? 'Hide setup steps' : 'How to set it up'}
        </button>
        {showSteps && (
          <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-700">
            <li>
              Sign up at{' '}
              <a href="https://x.razorpay.com" target="_blank" rel="noreferrer" className="font-semibold text-navy-800 underline inline-flex items-center gap-0.5">
                x.razorpay.com <ExternalLink className="w-3 h-3" />
              </a>{' '}
              with BKR INFRA's business details. Test mode works immediately; live needs KYC (PAN, GST certificate, bank account).
            </li>
            <li>RazorpayX → Settings → Developer Controls → generate API keys (Key ID and Key Secret).</li>
            <li>Copy the RazorpayX account number shown on the dashboard (My Account / Account details).</li>
            <li>
              Settings → Webhooks → Add: paste the webhook URL above, choose a secret, and tick:{' '}
              <span className="font-mono text-[11px]">{(data?.webhookEvents || []).join(', ')}</span>.
            </li>
            <li>
              On Render → backend service → Environment, add <span className="font-mono">RAZORPAYX_KEY_ID</span>,{' '}
              <span className="font-mono">RAZORPAYX_KEY_SECRET</span>, <span className="font-mono">RAZORPAYX_ACCOUNT_NUMBER</span> and{' '}
              <span className="font-mono">RAZORPAYX_WEBHOOK_SECRET</span>, then redeploy. Never paste these in chat or messages.
            </li>
            <li>
              Try a ₹1 test payout with test keys. For real money, switch to live keys and also add{' '}
              <span className="font-mono">PAYMENTS_LIVE_ENABLED=true</span>.
            </li>
          </ol>
        )}
      </CardContent>
    </Card>
  );
};
