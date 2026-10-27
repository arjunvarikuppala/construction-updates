import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  Upload,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  QrCode,
  ArrowRight,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../common/Button.js';

interface ParsedBeneficiaryResult {
  vpa: string;
  payeeName?: string;
  amountPaise?: number;
  amountInr?: number;
  transactionNote?: string;
  rawString: string;
}

interface UPIQRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBeneficiaryScanned: (data: ParsedBeneficiaryResult) => void;
}

export const UPIQRScannerModal: React.FC<UPIQRScannerModalProps> = ({
  isOpen,
  onClose,
  onBeneficiaryScanned,
}) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'upload'>('camera');
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [parsedResult, setParsedResult] = useState<ParsedBeneficiaryResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  // Backend verification of untrusted QR payload
  const verifyQrPayload = async (rawQr: string) => {
    try {
      setAnalyzing(true);
      setParseError(null);
      const res = await api.post<{
        success: boolean;
        parsed: {
          vpa: string;
          payeeName?: string;
          amountPaise?: number;
          transactionNote?: string;
          rawPayload: string;
        };
      }>('/payments/qr/parse', { qrString: rawQr });

      if (res.success && res.parsed) {
        setParsedResult({
          vpa: res.parsed.vpa,
          payeeName: res.parsed.payeeName,
          amountPaise: res.parsed.amountPaise,
          amountInr: res.parsed.amountPaise ? res.parsed.amountPaise / 100 : undefined,
          transactionNote: res.parsed.transactionNote,
          rawString: res.parsed.rawPayload,
        });
        stopCamera();
      } else {
        setParseError('The scanned QR code is not a valid UPI payment string.');
      }
    } catch (err: any) {
      setParseError(err?.message || 'Invalid or unsupported UPI QR code format.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Continuous frame scanning loop
  const scanFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          // Detected QR
          verifyQrPayload(code.data);
          return;
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }, []);

  // Start camera on request
  const startCamera = useCallback(async () => {
    try {
      stopCamera();
      setPermissionError(null);
      setHasCameraPermission(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      setHasCameraPermission(true);
      setScanning(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.play();
        animationFrameRef.current = requestAnimationFrame(scanFrame);
      }
    } catch (err: any) {
      setHasCameraPermission(false);
      setPermissionError(
        err.name === 'NotAllowedError'
          ? 'Camera access was denied by your browser. Please allow camera permissions or upload a QR image instead.'
          : 'Failed to access camera device. Please use the image upload option.'
      );
    }
  }, [scanFrame, stopCamera]);

  // Handle image file upload fallback
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setAnalyzing(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setAnalyzing(false);
          setParseError('Failed to process image canvas.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data) {
          verifyQrPayload(code.data);
        } else {
          setAnalyzing(false);
          setParseError('No UPI QR code found in the uploaded image. Please try a clearer picture.');
        }
      };
      img.onerror = () => {
        setAnalyzing(false);
        setParseError('Failed to load image file.');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Manage open/close lifecycle
  useEffect(() => {
    if (isOpen) {
      setParsedResult(null);
      setParseError(null);
      if (activeTab === 'camera') {
        startCamera();
      }
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-navy-950">Scan Beneficiary UPI QR</h3>
              <p className="text-[11px] text-slate-500">Auto-capture contractor/supplier UPI ID safely</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="px-6 pt-3 flex gap-2 border-b border-slate-100 pb-2">
          <button
            onClick={() => {
              setActiveTab('camera');
              setParsedResult(null);
              setParseError(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'camera'
                ? 'bg-navy-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Device Camera</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('upload');
              stopCamera();
              setParsedResult(null);
              setParseError(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'upload'
                ? 'bg-navy-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Upload QR Image</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Result view if scanned */}
          {parsedResult ? (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span className="font-bold text-sm">UPI Beneficiary Detected</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div>
                    <span className="text-emerald-700 block text-[10px] uppercase font-bold">UPI ID (VPA)</span>
                    <span className="font-mono font-bold text-navy-950 block break-all text-xs">
                      {parsedResult.vpa}
                    </span>
                  </div>
                  {parsedResult.payeeName && (
                    <div>
                      <span className="text-emerald-700 block text-[10px] uppercase font-bold">Payee Name</span>
                      <span className="font-bold text-navy-950 block truncate">
                        {parsedResult.payeeName}
                      </span>
                    </div>
                  )}
                  {parsedResult.amountInr !== undefined && parsedResult.amountInr > 0 && (
                    <div>
                      <span className="text-emerald-700 block text-[10px] uppercase font-bold">QR Amount</span>
                      <span className="font-bold text-emerald-800">
                        ₹{parsedResult.amountInr.toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}
                  {parsedResult.transactionNote && (
                    <div>
                      <span className="text-emerald-700 block text-[10px] uppercase font-bold">Note / Purpose</span>
                      <span className="font-medium text-slate-700 truncate block">
                        {parsedResult.transactionNote}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Safety notice */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 text-xs">
                <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Scanning this QR code does <strong>NOT</strong> initiate a transfer. All details will be populated into a formal payment request requiring MD authorization.
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setParsedResult(null);
                    if (activeTab === 'camera') startCamera();
                  }}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  Scan Another
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onBeneficiaryScanned(parsedResult);
                    onClose();
                  }}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Use Beneficiary Details
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Camera Scanner Tab */}
              {activeTab === 'camera' && (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-square max-h-[320px] mx-auto border-2 border-slate-200 flex items-center justify-center">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      playsInline
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Viewfinder Target Graphic */}
                    {scanning && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-48 h-48 border-2 border-amber-400 rounded-2xl relative shadow-lg">
                          <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-amber-400 rounded-tl" />
                          <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-amber-400 rounded-tr" />
                          <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-amber-400 rounded-bl" />
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-amber-400 rounded-br" />
                          <div className="absolute inset-x-0 h-0.5 bg-amber-400/80 top-1/2 animate-bounce" />
                        </div>
                      </div>
                    )}

                    {/* Loading or Permission Error */}
                    {analyzing && (
                      <div className="absolute inset-0 bg-navy-950/70 flex flex-col items-center justify-center text-white gap-2">
                        <RefreshCw className="w-7 h-7 text-amber-400 animate-spin" />
                        <span className="text-xs font-bold">Verifying UPI Payload...</span>
                      </div>
                    )}
                  </div>

                  {permissionError && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Camera Access Error</p>
                        <p className="text-[11px] mt-0.5">{permissionError}</p>
                      </div>
                    </div>
                  )}

                  <p className="text-center text-xs text-slate-500">
                    Align the contractor or supplier's UPI QR code inside the box to scan.
                  </p>
                </div>
              )}

              {/* Upload Tab */}
              {activeTab === 'upload' && (
                <div className="space-y-4">
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 rounded-2xl hover:border-amber-500 hover:bg-amber-50/20 cursor-pointer transition-colors text-center">
                    <Upload className="w-10 h-10 text-slate-400 mb-2" />
                    <span className="text-xs font-bold text-navy-950">Click or Drag & Drop QR Image</span>
                    <span className="text-[10px] text-slate-400 mt-1">PNG, JPG, WEBP up to 5MB</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </label>

                  {analyzing && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center flex items-center justify-center gap-2 text-xs font-bold text-slate-700">
                      <RefreshCw className="w-4 h-4 text-amber-500 animate-spin" />
                      <span>Reading and verifying QR code...</span>
                    </div>
                  )}
                </div>
              )}

              {parseError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Invalid UPI Code</p>
                    <p className="text-[11px] mt-0.5">{parseError}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
