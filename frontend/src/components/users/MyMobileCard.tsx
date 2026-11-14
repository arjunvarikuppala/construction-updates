/** Your own mobile number. Every account needs one. */
import React, { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Card, CardContent } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Input } from '../common/Input.js';
import { useAuth } from '../../context/AuthContext.js';
import { useToast } from '../../context/ToastContext.js';
import { api, ApiError } from '../../api/client.js';
import { normalizeIndianMobile, formatMobile, MOBILE_ERROR } from '../../utils/phone.js';

export const MyMobileCard: React.FC = () => {
  const { user, token, login } = useAuth();
  const { success } = useToast();
  const [value, setValue] = useState(user?.phone ? formatMobile(user.phone) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saved = user?.phone ? normalizeIndianMobile(user.phone) : null;

  const save = async () => {
    const n = normalizeIndianMobile(value);
    if (!n) return setError(MOBILE_ERROR);
    setSaving(true);
    setError('');
    try {
      const res = await api.put<{ phone: string }>('/auth/me/phone', { phone: n });
      if (user && token) login(token, { ...user, phone: res.phone });
      setValue(formatMobile(res.phone));
      success('Mobile number saved');
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-navy-950 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-navy-700" /> Your mobile number
          </h2>
          <p className="text-xs text-slate-500">Every account needs a mobile number, so the company can reach you.</p>
        </div>
        {!saved && (
          <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
            No mobile number yet. Add one now.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
          <div className="flex-1">
            <Input
              aria-label="Your mobile number"
              type="tel"
              inputMode="numeric"
              placeholder="+91 98765 43210"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
              error={error}
            />
          </div>
          <Button onClick={save} isLoading={saving} disabled={Boolean(saved) && normalizeIndianMobile(value) === saved}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
