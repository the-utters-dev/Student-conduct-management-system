import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Ensures the caller is a School Director for their school.
 * Returns the school_id and admin client.
 */
async function requireSchoolDirector(context: { supabase: SupabaseClient; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("school_id")
    .eq("id", context.userId)
    .maybeSingle();

  if (!profile?.school_id) {
    throw new Error("You must belong to a school to perform this action.");
  }

  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .in("role", ["school_director", "school_leader"] as any);

  if (!roles?.length) {
    throw new Error("Only School Directors can perform this action.");
  }

  return { schoolId: profile.school_id, admin: supabaseAdmin as unknown as SupabaseClient };
}

/**
 * Ensures the caller can issue certificates (School Director or Master of Discipline).
 */
async function requireCertificateIssuer(context: { supabase: SupabaseClient; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("school_id")
    .eq("id", context.userId)
    .maybeSingle();

  if (!profile?.school_id) {
    throw new Error("You must belong to a school to perform this action.");
  }

  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .in("role", ["school_director", "school_leader", "master_of_discipline"] as any);

  if (!roles?.length) {
    throw new Error("Only the School Director or Master of Discipline can issue certificates.");
  }

  return { schoolId: profile.school_id, admin: supabaseAdmin as unknown as SupabaseClient };
}

// =============================================================================
// SIGNATURE AND STAMP MANAGEMENT
// =============================================================================

/**
 * Upload signature or stamp to storage and update school_settings.
 * Only School Directors can upload.
 */
export const uploadCertificateBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    type: "signature" | "stamp";
    file_data: string; // Base64 data URL
    file_name: string;
    director_name?: string;
    director_title?: string;
  }) => {
    if (!d || typeof d !== "object") {
      throw new Error("Missing upload details.");
    }
    if (d.type !== "signature" && d.type !== "stamp") {
      throw new Error("Type must be 'signature' or 'stamp'.");
    }
    if (!d.file_data || !d.file_data.startsWith("data:image/")) {
      throw new Error("Invalid file data. Must be a data URL for an image.");
    }
    if (!d.file_name || d.file_name.length < 3) {
      throw new Error("Invalid file name.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const userId = (context as { userId: string }).userId;

    // Convert data URL to blob
    const base64Data = data.file_data.split(",")[1];
    if (!base64Data) throw new Error("Invalid file data format.");

    const buffer = Buffer.from(base64Data, "base64");
    const blob = new Blob([buffer], { type: "image/png" });

    // Upload to storage: school-branding/{schoolId}/{type}.png
    const storagePath = `${schoolId}/${data.type}.png`;

    const { error: uploadError } = await admin.storage
      .from("school-branding")
      .upload(storagePath, blob, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    // Update school_settings
    const updates: Record<string, any> = {};
    if (data.type === "signature") {
      updates["signature_path"] = storagePath;
      updates["signature_updated_at"] = new Date().toISOString();
      updates["signature_updated_by"] = userId;
      if (data.director_name) updates["director_name"] = data.director_name.trim();
      if (data.director_title) updates["director_title"] = data.director_title.trim();
    } else {
      updates["stamp_path"] = storagePath;
    }

    const { error: settingsError } = await (admin.from("school_settings" as never) as any)
      .update(updates)
      .eq("school_id", schoolId);

    if (settingsError) throw new Error(`Settings update failed: ${settingsError.message}`);

    // Audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: userId,
      action: `UPLOAD_CERTIFICATE_${data.type.toUpperCase()}`,
      entity_type: "school_settings",
      entity_id: schoolId,
      payload: { type: data.type, path: storagePath },
    });

    return { path: storagePath, ok: true };
  });

/**
 * Get signed URL for signature or stamp (for display in UI).
 */
export const getCertificateBrandingUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => {
    if (!d.path || typeof d.path !== "string") {
      throw new Error("Storage path is required.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Generate signed URL (expires in 1 hour)
    const { data: urlData, error } = await supabaseAdmin.storage
      .from("school-branding")
      .createSignedUrl(data.path, 3600);

    if (error) throw new Error(`Failed to get signed URL: ${error.message}`);

    return { url: urlData.signedUrl };
  });

// =============================================================================
// CERTIFICATE TEMPLATE MANAGEMENT
// =============================================================================

export interface CertificateTemplate {
  id: string;
  school_id: string;
  name: string;
  kind: "good_deed" | "student_of_period" | "graduation" | "custom";
  title: string;
  body: string;
  accent_color: string;
  border_style: "classic" | "modern" | "minimal";
  orientation: "landscape" | "portrait";
  show_signature: boolean;
  show_stamp: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new certificate template.
 * Only School Directors can create templates.
 */
export const createCertificateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    name: string;
    kind: "good_deed" | "student_of_period" | "graduation" | "custom";
    title: string;
    body: string;
    accent_color?: string;
    border_style?: "classic" | "modern" | "minimal";
    orientation?: "landscape" | "portrait";
    show_signature?: boolean;
    show_stamp?: boolean;
  }) => {
    if (!d.name?.trim() || !d.kind || !d.title?.trim() || !d.body?.trim()) {
      throw new Error("Name, kind, title, and body are required.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const userId = (context as { userId: string }).userId;

    const { data: template, error } = await (admin.from("certificate_templates" as never) as any)
      .insert({
        school_id: schoolId,
        name: data.name.trim(),
        kind: data.kind,
        title: data.title.trim(),
        body: data.body.trim(),
        accent_color: data.accent_color ?? "#3b82f6",
        border_style: data.border_style ?? "classic",
        orientation: data.orientation ?? "landscape",
        show_signature: data.show_signature ?? true,
        show_stamp: data.show_stamp ?? true,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return template;
  });

/**
 * Update an existing certificate template.
 * Only School Directors can update templates.
 */
export const updateCertificateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    name?: string;
    title?: string;
    body?: string;
    accent_color?: string;
    border_style?: "classic" | "modern" | "minimal";
    orientation?: "landscape" | "portrait";
    show_signature?: boolean;
    show_stamp?: boolean;
    is_active?: boolean;
  }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid template ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);

    const updates: Record<string, any> = {};
    if (data.name !== undefined) updates["name"] = data.name.trim();
    if (data.title !== undefined) updates["title"] = data.title.trim();
    if (data.body !== undefined) updates["body"] = data.body.trim();
    if (data.accent_color !== undefined) updates["accent_color"] = data.accent_color;
    if (data.border_style !== undefined) updates["border_style"] = data.border_style;
    if (data.orientation !== undefined) updates["orientation"] = data.orientation;
    if (data.show_signature !== undefined) updates["show_signature"] = data.show_signature;
    if (data.show_stamp !== undefined) updates["show_stamp"] = data.show_stamp;
    if (data.is_active !== undefined) updates["is_active"] = data.is_active;

    const { error } = await (admin.from("certificate_templates" as never) as any)
      .update(updates)
      .eq("id", data.id)
      .eq("school_id", schoolId);

    if (error) throw new Error(error.message);

    return { ok: true };
  });

// =============================================================================
// CERTIFICATE ISSUANCE
// =============================================================================

export interface IssuedCertificate {
  id: string;
  school_id: string;
  template_id: string;
  student_id: string;
  conduct_log_id: string | null;
  serial_no: string;
  verification_code: string;
  issued_by: string;
  issued_at: string;
  data: Record<string, any>;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
}

/**
 * Issue a certificate to a student.
 * School Directors and Master of Discipline can issue.
 */
export const issueCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    template_id: string;
    student_id: string;
    conduct_log_id?: string | null;
    data: Record<string, any>;
  }) => {
    if (!UUID.test(d.template_id)) throw new Error("Invalid template ID.");
    if (!UUID.test(d.student_id)) throw new Error("Invalid student ID.");
    if (!d.data || typeof d.data !== "object") throw new Error("Certificate data is required.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireCertificateIssuer(context as never);
    const userId = (context as { userId: string }).userId;

    // Generate serial and verification code
    const { data: serialData } = await (admin.rpc as any)("generate_certificate_serial", {
      _school_id: schoolId,
      _prefix: null,
    });
    const serial = serialData as string;

    const { data: codeData } = await (admin.rpc as any)("generate_verification_code");
    const verificationCode = codeData as string;

    // Insert certificate
    const { data: certificate, error } = await (admin.from("issued_certificates" as never) as any)
      .insert({
        school_id: schoolId,
        template_id: data.template_id,
        student_id: data.student_id,
        conduct_log_id: data.conduct_log_id ?? null,
        serial_no: serial,
        verification_code: verificationCode,
        issued_by: userId,
        data: data.data,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return certificate;
  });

/**
 * Bulk issue certificates (for graduation).
 * School Directors and Master of Discipline can bulk issue.
 */
export const bulkIssueCertificates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    template_id: string;
    students: Array<{
      student_id: string;
      data: Record<string, any>;
    }>;
  }) => {
    if (!UUID.test(d.template_id)) throw new Error("Invalid template ID.");
    if (!Array.isArray(d.students) || d.students.length === 0) {
      throw new Error("At least one student is required.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireCertificateIssuer(context as never);
    const userId = (context as { userId: string }).userId;

    const certificates: any[] = [];

    for (const student of data.students) {
      // Generate serial and verification code for each
      const { data: serialData } = await (admin.rpc as any)("generate_certificate_serial", {
        _school_id: schoolId,
        _prefix: null,
      });
      const serial = serialData as string;

      const { data: codeData } = await (admin.rpc as any)("generate_verification_code");
      const verificationCode = codeData as string;

      certificates.push({
        school_id: schoolId,
        template_id: data.template_id,
        student_id: student.student_id,
        serial_no: serial,
        verification_code: verificationCode,
        issued_by: userId,
        data: student.data,
      });
    }

    // Bulk insert
    const { data: inserted, error } = await (admin.from("issued_certificates" as never) as any)
      .insert(certificates)
      .select();

    if (error) throw new Error(error.message);

    return { certificates: inserted, count: inserted.length };
  });

/**
 * Revoke a certificate.
 * Only School Directors can revoke.
 */
export const revokeCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificate_id: string; reason?: string }) => {
    if (!UUID.test(d.certificate_id)) throw new Error("Invalid certificate ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const userId = (context as { userId: string }).userId;

    const { error } = await (admin.from("issued_certificates" as never) as any)
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
        revocation_reason: data.reason ?? null,
      })
      .eq("id", data.certificate_id)
      .eq("school_id", schoolId);

    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Check if a certificate has already been issued for a specific entry and template.
 * Returns the existing issued certificate if found.
 */
export const checkExistingCertificate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conduct_log_id?: string | null; student_id: string; template_id: string }) => {
    if (!UUID.test(d.student_id)) throw new Error("Invalid student ID.");
    if (!UUID.test(d.template_id)) throw new Error("Invalid template ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireCertificateIssuer(context as never);

    // Check for existing certificate
    const query = (admin.from("issued_certificates" as never) as any)
      .select("*")
      .eq("school_id", schoolId)
      .eq("student_id", data.student_id)
      .eq("template_id", data.template_id)
      .is("revoked_at", null);

    if (data.conduct_log_id) {
      query.eq("conduct_log_id", data.conduct_log_id);
    }

    const { data: existing, error } = await query.maybeSingle();

    if (error) throw new Error(error.message);

    return existing as IssuedCertificate | null;
  });
