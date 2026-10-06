// Reads text out of a payment screenshot, entirely on the driver's phone.
// The engine files are served from this site (public/tesseract), so no outside
// service is involved and nothing is uploaded for reading.

import { parseMomoText } from "./momo.js";

const TIMEOUT_MS = 25000;
const MAX_EDGE = 2200;
// Phone screenshots are often only ~400px wide. Tesseract misreads digits at that
// size, so small images are enlarged before reading.
const MIN_WIDTH = 1100;

let workerPromise = null;

function assetBase() {
  // Works at the site root and under /FleetLine/ on GitHub Pages.
  return new URL("tesseract/", document.baseURI).href;
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const base = assetBase();
      return createWorker("eng", 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base,
        logger: (m) => {
          if (m.status === "loading tesseract core" || m.status === "loading language traineddata") {
            onProgress?.({ stage: "download", progress: m.progress ?? 0 });
          } else if (m.status === "recognizing text") {
            onProgress?.({ stage: "reading", progress: m.progress ?? 0 });
          }
        },
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Screenshots are often dark mode; Tesseract wants dark text on light.
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  let scale = bitmap.width < MIN_WIDTH ? Math.min(3, MIN_WIDTH / bitmap.width) : 1;
  const longestEdge = Math.max(bitmap.width, bitmap.height) * scale;
  if (longestEdge > MAX_EDGE) scale *= MAX_EDGE / longestEdge;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = grey;
    total += grey;
  }
  const average = total / (data.length / 4);
  const invert = average < 110;

  // Light contrast stretch, plus inversion for dark-mode screenshots.
  for (let i = 0; i < data.length; i += 4) {
    let v = data[i];
    if (invert) v = 255 - v;
    v = Math.max(0, Math.min(255, (v - 128) * 1.25 + 128));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export function ocrSupported() {
  return typeof WebAssembly === "object" && typeof createImageBitmap === "function" && typeof Worker === "function";
}

// Returns { text, transactions } or throws. Never blocks the payment: callers fall back to typing.
export async function readScreenshot(file, { onProgress, signal } = {}) {
  if (!ocrSupported()) throw new Error("This phone can't read screenshots automatically.");

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Reading took too long.")), TIMEOUT_MS)
  );

  const work = (async () => {
    onProgress?.({ stage: "preparing", progress: 0 });
    const prepared = await prepareImage(file);
    if (signal?.aborted) throw new Error("Cancelled");
    const worker = await getWorker(onProgress);
    if (signal?.aborted) throw new Error("Cancelled");
    const { data } = await worker.recognize(prepared);
    const text = data?.text ?? "";
    return { text, transactions: parseMomoText(text) };
  })();

  return Promise.race([work, timeout]);
}
