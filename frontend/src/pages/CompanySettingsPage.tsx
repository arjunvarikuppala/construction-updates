import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, FileSpreadsheet, BadgeCheck, Download } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Input, Textarea } from '../components/common/Input.js';
import { useToast } from '../context/ToastContext.js';
import { api, API_ORIGIN } from '../api/client.js';
import { isValidGstin, useCompanySettings } from '../utils/gst.js';

/** MD only: BKR INFRA's legal name, GSTIN and address, plus the monthly GST purchase register. */
export const CompanySettingsPage: React.FC = () => {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useCompanySettings();

  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (data) {
      setLegalName(data.legalName || 'BKR INFRA');
      setGstin(data.gstin || '');
      setAddress(data.address || '');
    }
  }, [data]);

  const gstinError = gstin && gstin.length === 15 && !isValidGstin(gstin) ? 'GSTIN is not valid — check the characters' : undefined;

  const save = async () => {
    if (gstin && !isValidGstin(gstin)) {
      toastError('Enter a valid 15-character GSTIN or leave it empty');
      return;
    }
    setSaving(true);
    try {
      await api.put('/company-settings', { legalName, gstin, address });
      await queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      success('Company details saved');
    } catch (err: any) {
      toastError(err.message || 'Could not save company details');
    } finally {
      setSaving(false);
    }
  };

  const downloadRegister = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_ORIGIN}/api/v1/export/gst-register?month=${month}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('sitetrack_token') || ''}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Download failed');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `BKR-INFRA-GST-Register-${month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toastError(err.message || 'Could not download the GST register');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-navy-950">Company &amp; GST</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          BKR INFRA&apos;s GST details decide CGST + SGST vs IGST on bills and appear on reports and the GST register.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-navy-800" />
            <CardTitle>Company details</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Legal name (as on GST registration)" maxLength={150} value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={isLoading} />
          <Input
            label="GSTIN"
            maxLength={15}
            autoCapitalize="characters"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
            error={gstinError}
            helperText={gstin && isValidGstin(gstin) ? `State code ${gstin.slice(0, 2)} — vendors from this state are charged CGST + SGST, others IGST.` : '15 characters, from your GST registration certificate'}
            rightIcon={gstin && isValidGstin(gstin) ? <BadgeCheck className="w-4 h-4 text-emerald-600" /> : undefined}
            disabled={isLoading}
          />
          <Textarea label="Registered address" rows={3} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} disabled={isLoading} />
          <div className="flex justify-end">
            <Button onClick={save} isLoading={saving} disabled={isLoading}>
              Save details
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-navy-800" />
            <CardTitle>Monthly GST purchase register</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-600">
            Every GST bill from all sites for the month (by invoice date): vendor GSTIN, invoice no., taxable value, CGST, SGST,
            IGST and total. Give this Excel file to your CA for the GST return. Rejected bills are left out.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Input label="Month" type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <Button variant="outline" onClick={downloadRegister} isLoading={downloading} disabled={!month} leftIcon={<Download className="w-4 h-4" />}>
              Download Excel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
