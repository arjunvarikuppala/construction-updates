import { API_ORIGIN } from '../api/client.js';

/** Download a file from the API (signed-in) and save it with the given name. */
export async function downloadFromApi(path: string, fileName: string): Promise<void> {
  const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('sitetrack_token') || ''}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Download failed');
  }
  // Prefer the server's file name (it carries the date range)
  const served = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = served || fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
