import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { SocketProvider } from './context/SocketContext.js';
import { App } from './App.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import './index.css';

// Pages reload once if a deploy removed their code files (see reloadOnStaleChunk in App.tsx).
// The app loaded fine: allow one automatic reload again for the next deploy.
window.setTimeout(() => {
  try {
    sessionStorage.removeItem('bkr-chunk-reload');
  } catch {
    /* ignore */
  }
}, 15000);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 5000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <SocketProvider>
              <ErrorBoundary level="page">
                <App />
              </ErrorBoundary>
            </SocketProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
