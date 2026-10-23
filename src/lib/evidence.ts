import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fileToResizedDataUrl, convertToJpeg } from "@/lib/image";
import { isMissingColumn } from "@/lib/students";

/** Untyped client for tables/columns added by standalone SQL scripts. */
export const db = supabase as unknown as SupabaseClient;

export const EVIDENCE_BUCKET = "conduct-evidence";

export interface EvidenceResult {
  evidence_path: string | null;
  evidence_url: string | null;
  usedFallback: boolean;
}

/**
 * Upload to the conduct-evidence bucket under <school_id>/.
 * Always converts photos to JPEG (max 1600px, quality 0.8) to handle HEIC/WEBP from phones.
 * On any failure (network, missing bucket, permissions) keep a resized data URL instead
 * so the conduct entry itself always saves.
 */
export async function uploadEvidence(file: File | null, schoolId: string | null): Promise<EvidenceResult> {
  if (!file) return { evidence_path: null, evidence_url: null, usedFallback: false };
  try {
    // Convert to JPEG (handles HEIC, WEBP, large files, etc.)
    const jpegBlob = await convertToJpeg(file, 1600, 0.8);
    const path = `${schoolId ?? "unassigned"}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;

    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, jpegBlob, {
      contentType: "image/jpeg",
      upsert: false,
    });

    if (error) {
      console.error("Photo upload failed:", error.message);
      throw new Error(error.message);
    }

    // Private bucket: share a 30-day signed link (usable in parent messages).
    const { data, error: signErr } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    return { evidence_path: path, evidence_url: signErr ? null : data.signedUrl, usedFallback: false };
  } catch (err) {
    console.error("Evidence upload failed, storing a resized copy instead:", err);
    const dataUrl = await fileToResizedDataUrl(file, 800);
    return { evidence_path: null, evidence_url: dataUrl, usedFallback: true };
  }
}

/**
 * Insert a row; if the database doesn't have some optional columns yet,
 * retry without them. Returns which columns were dropped.
 */
export async function insertWithColumnFallback<T = { id: string }>(
  table: string,
  row: Record<string, unknown>,
  optional: string[],
  select = "id",
): Promise<{ data: T; dropped: string[] }> {
  let res = await db.from(table).insert(row).select(select).single();
  if (res.error && isMissingColumn(res.error)) {
    const slim = { ...row };
    optional.forEach((k) => delete slim[k]);
    res = await db.from(table).insert(slim).select(select).single();
    if (!res.error) return { data: res.data as T, dropped: optional };
  }
  if (res.error) throw res.error;
  return { data: res.data as T, dropped: [] };
}
