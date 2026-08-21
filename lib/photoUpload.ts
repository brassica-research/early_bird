import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_MAX_EDGE_PX,
} from "./rooms";

// ---------------------------------------------------------------------------
// Browser-side photo preparation for the intake form.
//
// Phones produce 3–12 MB captures. Uploading those raw would be slow on a
// driveway LTE connection and pointless — a technician looking at "which
// fitting is dripping?" needs about 1400px. So every picked image is drawn to
// a canvas, downscaled to fit that edge, re-encoded as JPEG, and only then
// queued for upload. That also strips EXIF (including GPS) as a side effect,
// which is the behavior we want for a customer's photo of their own home.
//
// Uses only browser APIs — import from client components only.
// ---------------------------------------------------------------------------

export interface PreparedPhoto {
  /** Local id for React keys + removal; not sent to the server. */
  localId: string;
  name: string;
  contentType: string;
  dataUrl: string;
  width: number;
  height: number;
  /** Decoded byte size after downscaling. */
  bytes: number;
}

/** What the API accepts — PreparedPhoto minus the client-only fields. */
export function toUploadPayload(p: PreparedPhoto) {
  return {
    name: p.name,
    contentType: p.contentType,
    dataUrl: p.dataUrl,
    width: p.width,
    height: p.height,
  };
}

export { MAX_PHOTOS };

function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be read as an image."));
    };
    img.src = url;
  });
}

/**
 * Downscale + re-encode one picked file. Quality steps down if the first
 * encode is still over budget, so a busy photo doesn't get rejected outright.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name || "That file"} isn't an image.`);
  }
  const img = await loadImage(file);
  const scale = Math.min(
    1,
    PHOTO_MAX_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process that photo.");
  ctx.drawImage(img, 0, 0, width, height);

  let dataUrl = "";
  let bytes = Infinity;
  for (const quality of [0.72, 0.6, 0.45, 0.32]) {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    bytes = dataUrlBytes(dataUrl);
    if (bytes <= MAX_PHOTO_BYTES) break;
  }
  if (bytes > MAX_PHOTO_BYTES) {
    throw new Error(`${file.name || "That photo"} is too large to attach.`);
  }

  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.slice(0, 200),
    contentType: "image/jpeg",
    dataUrl,
    width,
    height,
    bytes,
  };
}

/** Human-readable size, e.g. "412 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
