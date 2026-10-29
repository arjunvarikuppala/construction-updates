import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './Button.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  title?: string;
  message?: string;
  level?: 'page' | 'widget';
  widgetName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  public resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      const { fallback, title, message, level = 'page', widgetName } = this.props;
      const error = this.state.error || new Error('An unexpected rendering error occurred');

      if (typeof fallback === 'function') {
        return fallback(error, this.resetErrorBoundary);
      }

      if (fallback) {
        return fallback;
      }

      if (level === 'widget') {
        return (
          <div className="bg-white rounded-3xl border border-amber-200 p-5 shadow-card space-y-3">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <h4 className="text-sm font-bold">
                {title || `${widgetName || 'Component'} Temporarily Unavailable`}
              </h4>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {message || error.message || 'Unable to display this component due to an unexpected issue.'}
            </p>
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={this.resetErrorBoundary}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                className="text-xs"
              >
                Retry Component
              </Button>
            </div>
          </div>
        );
      }

      // Page level fallback
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-card text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 mx-auto flex items-center justify-center border border-amber-200">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-navy-950">
                {title || 'Dashboard Display Error'}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {message || error.message || 'An unexpected rendering problem occurred while loading this view.'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
              <Button
                size="sm"
                variant="amber"
                onClick={this.resetErrorBoundary}
                leftIcon={<RefreshCw className="w-4 h-4" />}
                className="w-full sm:w-auto font-bold"
              >
                Retry
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  window.location.href = '/';
                }}
                leftIcon={<Home className="w-4 h-4" />}
                className="w-full sm:w-auto"
              >
                Reload Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
