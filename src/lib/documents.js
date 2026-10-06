import { supabase } from "./supabase.js";

const BUCKET = "documents";
const urlCache = new Map();

export const DOCUMENT_KINDS = {
  agreement: "Signed agreement",
  insurance: "Insurance",
  roadworthy: "Roadworthy",
  other: "Other paper",
};

export const EXPIRY_STATUS = {
  valid: { tone: "green", label: "Valid" },
  expiring: { tone: "amber", label: "Expires soon" },
  expired: { tone: "red", label: "Expired" },
  none: { tone: "muted", label: "No expiry" },
};

const EXTENSIONS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// Files sit at "<access key>/<name>"; the key is created with the database row.
export async function uploadDocument(accessKey, file) {
  const extension = EXTENSIONS[file.type] ?? file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${accessKey}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function documentUrl(path) {
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function deleteDocumentFile(path) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}
