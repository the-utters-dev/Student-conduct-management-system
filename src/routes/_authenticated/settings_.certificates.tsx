import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  type CertificateTemplate,
  type IssuedCertificate,
  updateCertificateTemplate,
  createCertificateTemplate,
  revokeCertificate,
} from "@/lib/certificate.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/settings_/certificates")({
  component: CertificatesPage,
});

const panel = "rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl";
const inp = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-ink outline-none";
const btn = "rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-60";

function CertificatesPage() {
  return (
    <DashboardShell greeting="Certificates" dateLine="Templates, issued certificates & branding">
      <Tabs defaultValue="templates">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="issued">Issued Certificates</TabsTrigger>
        </TabsList>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="issued"><IssuedTab /></TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function TemplatesTab() {
  const { schoolId } = useAuth();
  const qc = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<CertificateTemplate | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["certificate-templates-all", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("certificate_templates" as never) as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CertificateTemplate[];
    },
    enabled: !!schoolId,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (template: CertificateTemplate) => {
      return await updateCertificateTemplate({
        data: {
          id: template.id,
          is_active: !template.is_active,
        },
      } as never);
    },
    onSuccess: () => {
      toast.success("Template updated");
      void qc.invalidateQueries({ queryKey: ["certificate-templates-all", schoolId] });
      void qc.invalidateQueries({ queryKey: ["certificate-templates", schoolId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (isLoading) {
    return (
      <div className={panel}>
        <p className="text-sm text-soft">Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-soft">
          Manage certificate templates. Only active templates can be used to issue certificates.
        </p>
        <button
          onClick={() => setCreatingNew(true)}
          className={btn}
        >
          Create Template
        </button>
      </div>

      {templates && templates.length > 0 ? (
        <div className="space-y-3">
          {templates.map((template) => (
            <div key={template.id} className={panel}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-display text-base font-bold text-ink">{template.name}</h3>
                  <p className="mt-1 text-xs text-soft">
                    {template.kind} · {template.orientation} · {template.border_style}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        template.is_active ? "bg-ok/20 text-ok" : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {template.is_active ? "Active" : "Inactive"}
                    </span>
                    <span
                      className="h-4 w-4 rounded-full border-2"
                      style={{ borderColor: template.accent_color, backgroundColor: template.accent_color }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="rounded-xl bg-glass-bright px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-hairline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActiveMutation.mutate(template)}
                    disabled={toggleActiveMutation.isPending}
                    className="rounded-xl bg-glass-bright px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-hairline disabled:opacity-50"
                  >
                    {template.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={panel}>
          <p className="text-center text-sm text-soft">No templates found. Create your first template to get started.</p>
        </div>
      )}

      {(editingTemplate || creatingNew) && (
        <TemplateEditorDialog
          template={editingTemplate}
          onClose={() => {
            setEditingTemplate(null);
            setCreatingNew(false);
          }}
        />
      )}
    </div>
  );
}

function TemplateEditorDialog({
  template,
  onClose,
}: {
  template: CertificateTemplate | null;
  onClose: () => void;
}) {
  const { schoolId } = useAuth();
  const qc = useQueryClient();
  const isNew = !template;

  const [formData, setFormData] = useState<Partial<CertificateTemplate>>({
    name: template?.name ?? "",
    kind: template?.kind ?? "good_deed",
    title: template?.title ?? "Certificate of Good Conduct",
    body: template?.body ?? "",
    accent_color: template?.accent_color ?? "#3b82f6",
    border_style: template?.border_style ?? "classic",
    orientation: template?.orientation ?? "landscape",
    show_signature: template?.show_signature ?? true,
    show_stamp: template?.show_stamp ?? true,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return await createCertificateTemplate({ data: formData as any } as never);
      } else {
        return await updateCertificateTemplate({
          data: {
            id: template.id,
            ...formData,
          },
        } as never);
      }
    },
    onSuccess: () => {
      toast.success(isNew ? "Template created" : "Template updated");
      void qc.invalidateQueries({ queryKey: ["certificate-templates-all", schoolId] });
      void qc.invalidateQueries({ queryKey: ["certificate-templates", schoolId] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Create Certificate Template" : "Edit Template"}</DialogTitle>
          <DialogDescription>
            Configure the template's appearance and content. Use placeholders like {"{student_name}"}, {"{class}"}, {"{admission_no}"}, {"{category}"}, {"{details}"}, {"{date}"}, {"{school_name}"}, {"{director_name}"}, {"{conduct_score}"}, {"{max_marks}"}, {"{term}"}, {"{academic_year}"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block text-xs font-semibold text-soft">
            Template Name
            <input
              type="text"
              className={`${inp} mt-1`}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Certificate of Good Conduct"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-soft">
              Type
              <select
                className={`${inp} mt-1`}
                value={formData.kind}
                onChange={(e) => setFormData({ ...formData, kind: e.target.value as any })}
              >
                <option value="good_deed">Good Deed</option>
                <option value="student_of_period">Student of the Month/Term</option>
                <option value="graduation">Graduation</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-soft">
              Orientation
              <select
                className={`${inp} mt-1`}
                value={formData.orientation}
                onChange={(e) => setFormData({ ...formData, orientation: e.target.value as any })}
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
          </div>

          <label className="block text-xs font-semibold text-soft">
            Title
            <input
              type="text"
              className={`${inp} mt-1`}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Certificate of Good Conduct"
            />
          </label>

          <label className="block text-xs font-semibold text-soft">
            Body Text (supports placeholders and line breaks)
            <textarea
              className={`${inp} mt-1`}
              rows={8}
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="This is to certify that..."
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-soft">
              Accent Color
              <input
                type="color"
                className="mt-1 h-10 w-full rounded-xl border border-input"
                value={formData.accent_color}
                onChange={(e) => setFormData({ ...formData, accent_color: e.target.value })}
              />
            </label>

            <label className="block text-xs font-semibold text-soft">
              Border Style
              <select
                className={`${inp} mt-1`}
                value={formData.border_style}
                onChange={(e) => setFormData({ ...formData, border_style: e.target.value as any })}
              >
                <option value="classic">Classic (Double Border)</option>
                <option value="modern">Modern (Gradient)</option>
                <option value="minimal">Minimal (Simple Line)</option>
              </select>
            </label>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={formData.show_signature}
                onChange={(e) => setFormData({ ...formData, show_signature: e.target.checked })}
              />
              Show Signature
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={formData.show_stamp}
                onChange={(e) => setFormData({ ...formData, show_stamp: e.target.checked })}
              />
              Show Stamp
            </label>
          </div>

          {/* Live Preview */}
          <div className="rounded-xl border-2 border-glass-line bg-white p-6">
            <p className="mb-2 text-xs font-semibold text-soft">Live Preview</p>
            <div
              className={`border-2 p-6 ${
                formData.border_style === "classic"
                  ? "border-double border-4"
                  : formData.border_style === "modern"
                  ? "bg-gradient-to-br from-white to-gray-50"
                  : ""
              }`}
              style={{ borderColor: formData.accent_color }}
            >
              <div className="text-center">
                <div className="mb-4 border-b-2 border-t-2 py-2" style={{ borderColor: formData.accent_color }}>
                  <h3 className="font-display text-2xl font-bold" style={{ color: formData.accent_color }}>
                    {formData.title || "Title"}
                  </h3>
                </div>
                <p className="whitespace-pre-line text-sm text-ink">{formData.body || "Body text..."}</p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="rounded-xl bg-glass-bright px-4 py-2 text-sm font-semibold text-ink ring-1 ring-hairline"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !formData.name || !formData.title || !formData.body}
            className={btn}
          >
            {saveMutation.isPending ? "Saving..." : isNew ? "Create" : "Save Changes"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssuedTab() {
  const { schoolId } = useAuth();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTemplateId, setFilterTemplateId] = useState<string | null>(null);
  const [revokeDialog, setRevokeDialog] = useState<IssuedCertificate | null>(null);

  const { data: issued, isLoading } = useQuery({
    queryKey: ["issued-certificates", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("issued_certificates" as never) as any)
        .select(`
          *,
          students(full_name),
          certificate_templates(name)
        `)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data as (IssuedCertificate & {
        students: { full_name: string };
        certificate_templates: { name: string };
      })[];
    },
    enabled: !!schoolId,
  });

  const { data: templates } = useQuery({
    queryKey: ["certificate-templates-all", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("certificate_templates" as never) as any)
        .select("*");
      if (error) throw error;
      return data as CertificateTemplate[];
    },
    enabled: !!schoolId,
  });

  const filtered = issued?.filter((cert) => {
    const matchesSearch =
      !searchQuery ||
      cert.serial_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (cert.data as any)?.student_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTemplate = !filterTemplateId || cert.template_id === filterTemplateId;

    return matchesSearch && matchesTemplate;
  });

  if (isLoading) {
    return (
      <div className={panel}>
        <p className="text-sm text-soft">Loading issued certificates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Search by serial or student name..."
          className={inp}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className={`${inp} sm:w-64`}
          value={filterTemplateId ?? ""}
          onChange={(e) => setFilterTemplateId(e.target.value || null)}
        >
          <option value="">All Templates</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {filtered && filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-glass-line text-xs uppercase text-soft">
              <tr>
                <th className="px-4 py-3">Serial</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cert) => (
                <tr key={cert.id} className="border-b border-glass-line">
                  <td className="px-4 py-3 font-mono text-xs">{cert.serial_no}</td>
                  <td className="px-4 py-3">{(cert.data as any)?.student_name ?? "Unknown"}</td>
                  <td className="px-4 py-3">{cert.certificate_templates?.name ?? "Unknown"}</td>
                  <td className="px-4 py-3 text-xs text-soft">
                    {new Date(cert.issued_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3">
                    {cert.revoked_at ? (
                      <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-semibold text-danger">
                        Revoked
                      </span>
                    ) : (
                      <span className="rounded-full bg-ok/20 px-2 py-0.5 text-xs font-semibold text-ok">
                        Valid
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <a
                        href={`/verify/${cert.verification_code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-brand underline"
                      >
                        Verify
                      </a>
                      {!cert.revoked_at && (
                        <button
                          onClick={() => setRevokeDialog(cert)}
                          className="text-xs font-semibold text-danger underline"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={panel}>
          <p className="text-center text-sm text-soft">
            {searchQuery || filterTemplateId
              ? "No certificates match your search."
              : "No certificates have been issued yet."}
          </p>
        </div>
      )}

      {revokeDialog && (
        <RevokeDialog certificate={revokeDialog} onClose={() => setRevokeDialog(null)} />
      )}
    </div>
  );
}

function RevokeDialog({
  certificate,
  onClose,
}: {
  certificate: IssuedCertificate;
  onClose: () => void;
}) {
  const { schoolId } = useAuth();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const revokeMutation = useMutation({
    mutationFn: async () => {
      return await revokeCertificate({
        data: {
          certificate_id: certificate.id,
          reason: reason.trim() || undefined,
        },
      } as never);
    },
    onSuccess: () => {
      toast.success("Certificate revoked");
      void qc.invalidateQueries({ queryKey: ["issued-certificates", schoolId] });
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke Certificate</DialogTitle>
          <DialogDescription>
            You are about to revoke certificate {certificate.serial_no}. This action cannot be undone. The certificate
            will be marked as invalid and will fail verification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block text-xs font-semibold text-soft">
            Reason for Revocation (optional)
            <textarea
              className={`${inp} mt-1`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Issued in error, student conduct review"
            />
          </label>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="rounded-xl bg-glass-bright px-4 py-2 text-sm font-semibold text-ink ring-1 ring-hairline"
          >
            Cancel
          </button>
          <button
            onClick={() => revokeMutation.mutate()}
            disabled={revokeMutation.isPending}
            className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
          >
            {revokeMutation.isPending ? "Revoking..." : "Revoke Certificate"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
