import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  Upload,
  CheckCircle2,
  DollarSign,
  Receipt,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Input, Textarea, Select } from '../components/common/Input.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Project, ExpenseCategory } from '../types/index.js';
import { api } from '../api/client.js';

const CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'CONSTRUCTION_MATERIALS', label: 'Construction Materials' },
  { value: 'LABOUR', label: 'Labour' },
  { value: 'DIESEL_AND_FUEL', label: 'Diesel and Fuel' },
  { value: 'MACHINERY_AND_EQUIPMENT', label: 'Machinery & Equipment' },
  { value: 'TRANSPORTATION', label: 'Transportation' },
  { value: 'FOOD_AND_ACCOMMODATION', label: 'Food & Accommodation' },
  { value: 'REPAIRS_AND_MAINTENANCE', label: 'Repairs & Maintenance' },
  { value: 'OTHER', label: 'Other Operational' },
];

export const ExpenseFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<ExpenseCategory>('CONSTRUCTION_MATERIALS');
  const [amountRupees, setAmountRupees] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-expense'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  const projects = projectsData?.projects || [];

  useEffect(() => {
    if (projects.length > 0 && !projectId) {
      setProjectId(projects[0]._id || projects[0].id!);
    }
  }, [projects, projectId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);

    try {
      const res = await api.post<{ success: boolean; fileUrl: string }>('/uploads/single', formData);
      if (res.success && res.fileUrl) {
        setReceiptUrl(res.fileUrl);
        success('Receipt uploaded successfully!');
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to upload receipt');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (status: 'DRAFT' | 'PENDING') => {
    if (!projectId) {
      toastError('Please select a project');
      return;
    }
    if (!date) {
      toastError('Please specify the date');
      return;
    }
    const numericAmount = parseFloat(amountRupees);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toastError('Please enter a valid amount greater than zero');
      return;
    }
    if (!vendor.trim()) {
      toastError('Vendor or payee name is required');
      return;
    }
    if (!description.trim()) {
      toastError('Description is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        project: projectId,
        date,
        category,
        amount: numericAmount, // Backend converts rupees to integer paise
        vendor: vendor.trim(),
        description: description.trim(),
        receiptUrl: receiptUrl.trim() || undefined,
        status,
      };

      await api.post('/expenses', payload);

      success(
        status === 'DRAFT'
          ? 'Expense draft saved'
          : 'Expense submitted! Managing Director will review on laptop.'
      );
      navigate('/expenses');
    } catch (err: any) {
      toastError(err.message || 'Failed to submit expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-slate-200">
        <button
          onClick={() => navigate('/expenses')}
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950">Record On-Site Expense</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Submit material purchase bills, equipment hire vouchers, fuel receipts, or labour payouts.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Project, Category, Date */}
        <Card>
          <CardHeader>
            <CardTitle>Expense Classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Construction Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                <option value="">Select Project</option>
                {projects.map((p) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Select>

              <Select
                label="Expense Category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                options={CATEGORIES}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Amount (in ₹ Rupees)"
                type="number"
                step="0.01"
                placeholder="E.g., 85000"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                required
              />

              <Input
                label="Expense Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <Input
              label="Vendor / Payee / Subcontractor Name"
              placeholder="E.g., Tata Tiscon Authorized Dealer, Indian Oil Retail"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              required
            />

            <Textarea
              label="Detailed Purpose & Scope"
              placeholder="E.g., 15 MT Fe 550D TMT rebar for 4th floor slab; includes transit freight..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </CardContent>
        </Card>

        {/* Bill Receipt Upload */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Receipt / Invoice Photo Attachment</CardTitle>
              <p className="text-xs text-slate-500">Attach stamped tax invoice, weighbridge receipt, or voucher</p>
            </div>
            <label className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-navy-900 text-white text-xs font-semibold cursor-pointer hover:bg-navy-800 transition-colors">
              <Camera className="w-4 h-4 text-amber-400" />
              <span>{isUploading ? 'Uploading...' : 'Take Photo / Upload'}</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </label>
          </CardHeader>
          <CardContent>
            {receiptUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 max-h-72 flex items-center justify-center p-2">
                <img
                  src={receiptUrl}
                  alt="Receipt"
                  className="max-h-64 object-contain rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setReceiptUrl('')}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-navy-950/80 text-white hover:bg-rose-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2">
                <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs text-slate-500">
                  No bill attached. Tap &quot;Take Photo / Upload&quot; to attach the paper receipt.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Statutory notice */}
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p>
            Monetary values are stored in accurate integer paise. Submissions undergo owner review and are synchronized in real-time across laptops and mobile devices.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => handleSubmit('DRAFT')}
            disabled={isSubmitting}
          >
            Save Draft
          </Button>

          <Button
            type="button"
            variant="amber"
            className="w-full sm:w-auto font-bold"
            onClick={() => handleSubmit('PENDING')}
            isLoading={isSubmitting}
            leftIcon={<CheckCircle2 className="w-4 h-4 text-navy-950" />}
          >
            Submit for Owner Approval
          </Button>
        </div>
      </div>
    </div>
  );
};
