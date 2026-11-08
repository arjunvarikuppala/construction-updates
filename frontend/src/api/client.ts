// ---------------------------------------------------------------------------
// API origin resolution
//
// Development (Vite dev server):   VITE_API_URL is NOT set → BASE_URL = '/api/v1'
//   All requests go to relative paths which Vite proxies to localhost:5000.
//
// Production (Vercel):             VITE_API_URL = 'https://<your-service>.onrender.com'
//   All requests go directly to the Render backend. No server-side proxy needed.
// ---------------------------------------------------------------------------
export const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const BASE_URL = `${API_ORIGIN}/api/v1`;

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('sitetrack_token');
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // If body is NOT FormData and not GET/HEAD, set application/json
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      const isAuthEndpoint = endpoint.includes('/auth/login') || endpoint.includes('/auth/register');
      if (!isAuthEndpoint) {
        localStorage.removeItem('sitetrack_token');
        localStorage.removeItem('sitetrack_user');
        sessionStorage.setItem('sitetrack_auth_message', 'Your session has expired or is invalid. Please sign in again.');
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
    }

    // Handle Excel download responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('spreadsheetml')) {
      return (await response.blob()) as unknown as T;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ApiError(data.message || `Request failed with status ${response.status}`, response.status, data);
    }

    return data;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // Outdated or cancelled request: let caller handle abort cleanly
      throw err;
    }
    throw err;
  }
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { method: 'GET', ...options }),
  post: <T>(endpoint: string, body?: any, options?: RequestInit) =>
    request<T>(endpoint, {
      method: 'POST',
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  put: <T>(endpoint: string, body?: any, options?: RequestInit) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  delete: <T>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { method: 'DELETE', ...options }),
};
