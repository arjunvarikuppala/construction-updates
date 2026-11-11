/**
 * Prepare photos and videos on the phone before upload:
 *  - photos are resized to at most 1920 px and re-compressed (a 6 MB camera photo
 *    becomes roughly 300-700 KB), which makes uploads from site much faster;
 *  - a small preview (480 px) is made for photos, and a poster frame for videos,
 *    so the chat shows light previews instead of downloading every full file.
 *
 * Everything here is best-effort: if the browser can't decode a file (e.g. some
 * iPhone HEVC videos on desktop Chrome), the original is uploaded without a preview.
 */

const MAX_EDGE = 1920;
const PHOTO_QUALITY = 0.82;
const THUMB_EDGE = 480;
const THUMB_QUALITY = 0.7;
const STEP_TIMEOUT_MS = 8000;

export interface PreparedMedia {
  file: File;
  thumb: Blob | null;
  width?: number;
  height?: number;
  duration?: number;
}

type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement;

function withTimeout<T>(promise: Promise<T>, ms = STEP_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function decodeImage(file: Blob): Promise<{ source: Drawable; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await withTimeout(img.decode());
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source: Drawable, width: number, height: number, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  // White behind transparent PNGs (JPEG has no transparency)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** Resize + re-compress a photo and make its preview. Never throws. */
export async function preparePhoto(file: File): Promise<PreparedMedia> {
  try {
    const decoded = await withTimeout(decodeImage(file));
    try {
      let out = file;
      let width = decoded.width;
      let height = decoded.height;

      const full = drawScaled(decoded.source, decoded.width, decoded.height, MAX_EDGE);
      const compressed = await canvasToJpeg(full, PHOTO_QUALITY);
      // Keep the original if re-compressing doesn't make it meaningfully smaller
      if (compressed && compressed.size < file.size * 0.9) {
        const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
        out = new File([compressed], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
        width = full.width;
        height = full.height;
      }

      const thumbCanvas = drawScaled(decoded.source, decoded.width, decoded.height, THUMB_EDGE);
      const thumb = await canvasToJpeg(thumbCanvas, THUMB_QUALITY);
      return { file: out, thumb, width, height };
    } finally {
      decoded.close();
    }
  } catch {
    return { file, thumb: null };
  }
}

/** Grab a poster frame, size and length from a video. Never throws. */
export async function prepareVideo(file: File): Promise<PreparedMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('cannot decode video'));
      })
    );
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
    const width = video.videoWidth || undefined;
    const height = video.videoHeight || undefined;

    // A frame a little into the clip is more useful than the (often black) first frame
    const target = duration ? Math.min(1, duration / 3) : 0;
    if (target > 0) {
      await withTimeout(
        new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = target;
        })
      );
    }

    let thumb: Blob | null = null;
    if (width && height) {
      const canvas = drawScaled(video, width, height, THUMB_EDGE);
      thumb = await canvasToJpeg(canvas, THUMB_QUALITY);
    }
    return { file, thumb, width, height, duration };
  } catch {
    return { file, thumb: null };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
