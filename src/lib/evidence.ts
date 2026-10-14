import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fileToResizedDataUrl } from "@/lib/image";
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
 * Upload to the conduct-evidence bucket under <school_id>/. On any failure
 * (network, missing bucket, permissions) keep a resized data URL instead so
 * the conduct entry itself always saves.
 */
export async function uploadEvidence(file: File | null, schoolId: string | null): Promise<EvidenceResult> {
  if (!file) return { evidence_path: null, evidence_url: null, usedFallback: false };
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${schoolId ?? "unassigned"}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    // Private bucket: share a 30-day signed link (usable in parent messages).
    const { data, error: signErr } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    return { evidence_path: path, evidence_url: signErr ? null : data.signedUrl, usedFallback: false };
  } catch (err) {
    console.warn("Evidence upload failed, storing a resized copy instead", err);
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
