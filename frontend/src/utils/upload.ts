import { API_ORIGIN } from '../api/client.js';

export interface UploadedFileInfo {
  url: string;
  originalName: string;
  size?: number;
  mimetype?: string;
}

export const MAX_UPLOAD_MB = 100;

/**
 * Upload one file with real progress reporting (fetch() cannot report upload
 * progress). Uses the same Authorization header as the API client.
 */
export function uploadFileWithProgress(file: File, onProgress?: (percent: number) => void): Promise<UploadedFileInfo> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      reject(new Error(`${file.name} is larger than ${MAX_UPLOAD_MB} MB.`));
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_ORIGIN}/api/v1/uploads/single`);
    const token = localStorage.getItem('sitetrack_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.fileUrl) {
        resolve({ url: body.fileUrl, originalName: body.originalName || file.name, size: body.size, mimetype: body.mimetype });
      } else if (xhr.status === 401) {
        reject(new Error('Your session expired. Please sign in again.'));
      } else {
        reject(new Error(body.message || `Upload failed (${xhr.status || 'network error'})`));
      }
    };
    xhr.onerror = () => reject(new Error(navigator.onLine ? 'Upload failed. Check your connection and retry.' : 'You are offline. Connect to the internet to upload.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Please retry.'));
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(form);
  });
}

/** Stable random id for idempotent submissions. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
