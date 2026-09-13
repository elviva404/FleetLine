import { supabase } from "./supabase.js";

const BUCKET = "screenshots";
const urlCache = new Map();

// Files live under the driver's storage key folder; the database checks this.
export async function uploadScreenshot(storageKey, blob) {
  const path = `${storageKey}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

export async function screenshotUrl(path) {
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
