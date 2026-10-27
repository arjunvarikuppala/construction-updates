import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Building2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../common/Button.js';
import { useToast } from '../../context/ToastContext.js';

interface PaymentQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  projectName?: string;
}

export const PaymentQrModal: React.FC<PaymentQrModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
}) => {
  const { showToast } = useToast();
  const [amountInr, setAmountInr] = useState<number | ''>(1000);
  const [description, setDescription] = useState('SiteTrack Advance Collection');
  const [isGenerating, setIsGenerating] = useState(false);
  const [qrData, setQrData] = useState<{
    qrId: string;
    imageUrl?: string;
    qrString: string;
    amountPaise: number;
    expiresAt: string;
  } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(900); // 15 min
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Generate QR on submit
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountInr || amountInr <= 0) {
      showToast('Please enter a valid amount greater than 0', 'error');
      return;
    }

    try {
      setIsGenerating(true);
      const res = await api.post<{
        success: boolean;
        qr: {
          qrId: string;
          imageUrl?: string;
          qrString: string;
          amountPaise: number;
          expiresAt: string;
        };
      }>('/payments/qr/generate', {
        amountPaise: Math.round(Number(amountInr) * 100),
        description,
        projectId,
      });

      if (res.success && res.qr) {
        setQrData(res.qr);
        setRemainingSeconds(900);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to generate dynamic payment QR', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Render QR string to canvas
  useEffect(() => {
    if (qrData?.qrString && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrData.qrString, {
        width: 240,
        margin: 2,
        color: {
          dark: '#020b1e',
          light: '#ffffff',
        },
      });
    }
  }, [qrData]);

  // Countdown timer
  useEffect(() => {
    if (!qrData || remainingSeconds <= 0) return;

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [qrData, remainingSeconds]);

  const copyQrString = () => {
    if (qrData?.qrString) {
      navigator.clipboard.writeText(qrData.qrString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('UPI Intent link copied to clipboard', 'info');
    }
  };

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-navy-950">Dynamic Payment QR</h3>
              <p className="text-[11px] text-slate-500">Collect funds via UPI QR into merchant escrow</p>
            </div>
          </div>
          <button
            onClick={() => {
              setQrData(null);
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          {!qrData ? (
            <form onSubmit={handleGenerate} className="space-y-4">
              {projectName && (
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
                  <Building2 className="w-4 h-4 text-navy-800 flex-shrink-0" />
                  <span className="font-semibold truncate">Project: {projectName}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Collection Amount (₹ INR) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={amountInr}
                    onChange={(e) => setAmountInr(e.target.value ? Number(e.target.value) : '')}
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-navy-950 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                    placeholder="Enter amount"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Payment Purpose / Description *
                </label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  placeholder="e.g. Project advance or site deposit"
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs">
                <span className="font-bold text-navy-900 block mb-0.5">Important Security Notice</span>
                <span className="text-[11px] block leading-relaxed">
                  This generates a verified collection QR through the payment provider. Customer or client scans to pay.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose} type="button">
                  Cancel
                </Button>
                <Button variant="primary" type="submit" isLoading={isGenerating}>
                  Generate UPI QR
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 text-center">
              {/* Countdown Pill */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
                <Clock className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                <span>Expires in {formatTimer(remainingSeconds)}</span>
              </div>

              {/* QR Code Canvas */}
              <div className="p-4 bg-white rounded-2xl border-2 border-slate-200 shadow-md inline-block">
                <canvas ref={canvasRef} className="mx-auto" />
              </div>

              {/* Amount Display */}
              <div>
                <span className="text-2xl font-black text-navy-950">
                  ₹{(qrData.amountPaise / 100).toLocaleString('en-IN')}
                </span>
                <span className="block text-xs text-slate-500 font-medium mt-0.5">
                  Scan using Google Pay, PhonePe, Paytm, or BHIM
                </span>
              </div>

              {/* UPI ID / Intent Action */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
                <div className="text-left truncate mr-2">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">QR Reference ID</span>
                  <span className="font-mono text-navy-900 font-bold text-xs truncate block">
                    {qrData.qrId}
                  </span>
                </div>
                <button
                  onClick={copyQrString}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy URI'}</span>
                </button>
              </div>

              {remainingSeconds === 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <span>This payment QR has expired. Please generate a new one.</span>
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setQrData(null)}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  Generate Another
                </Button>
                <Button variant="primary" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
