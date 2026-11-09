import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { QRCode } from "@/components/QRCode";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { fileToDataUrl } from "@/lib/image-transparency";
import {
  type CertificateTemplate,
  type IssuedCertificate,
  updateCertificateTemplate,
  createCertificateTemplate,
  revokeCertificate,
  uploadCertificateBranding,
  getCertificateBrandingUrl,
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
const PRESETS = [
  {
    name: "Honor Roll",
    kind: "student_of_period" as const,
    title: "Certificate of Academic Excellence",
    body: "This certificate is proudly presented to {{student_name}} of {{class_level}} for outstanding achievement during the {{academic_year}} academic year.",
    header_text: "Honouring achievement and dedication",
    accent_color: "#986b16",
    secondary_color: "#d8bc73",
    border_style: "classic" as const,
  },
  {
    name: "Exemplary Discipline",
    kind: "good_deed" as const,
    title: "Certificate of Exemplary Conduct",
    body: "This certificate recognizes {{student_name}} for consistently demonstrating respect, responsibility, and positive conduct. Issued {{issue_date}}.",
    header_text: "A record of character and respect",
    accent_color: "#176b5b",
    secondary_color: "#9bc8b2",
    border_style: "modern" as const,
  },
  {
    name: "Leadership & Merit",
    kind: "custom" as const,
    title: "Leadership and Merit Award",
    body: "Presented to {{student_name}}, {{gender}} student of {{class_level}}, in recognition of exemplary leadership and service during {{academic_year}}.",
    header_text: "Recognising service and leadership",
    accent_color: "#314d82",
    secondary_color: "#a9bada",
    border_style: "minimal" as const,
  },
  {
    name: "Sports Achievement",
    kind: "custom" as const,
    title: "Certificate of Sports Achievement",
    body: "Awarded to {{student_name}} of {{class_level}} for commitment, teamwork, and achievement in school sports. Issued {{issue_date}}.",
    header_text: "Celebrating effort and teamwork",
    accent_color: "#a84d2a",
    secondary_color: "#e7b28e",
    border_style: "modern" as const,
  },
];

function CertificatesPage() {
  return (
    <DashboardShell greeting="Certificates" dateLine="Templates, issued certificates & branding">
      <Tabs defaultValue="templates">
        <TabsList className="mb-4 flex w-full flex-nowrap justify-start overflow-x-auto [mask-image:linear-gradient(90deg,transparent,black_1rem,black_calc(100%_-_1rem),transparent)]">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="issued">Issued Certificates</TabsTrigger>
        </TabsList>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="issued"><IssuedTab /></TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function TemplateMockPreview({
  title,
  body,
  headerText,
  primaryColor,
  secondaryColor,
  borderStyle,
}: {
  title: string;
  body: string;
  headerText: string;
  primaryColor: string;
  secondaryColor: string;
  borderStyle: "classic" | "modern" | "minimal";
}) {
  const borderClass = borderStyle === "classic" ? "border-double border-4" : borderStyle === "modern" ? "border-2" : "border";
  return (
    <div className={`${borderClass} aspect-[1.4] overflow-hidden bg-white p-2 text-center shadow-sm sm:p-3`} style={{ borderColor: primaryColor }}>
      <div className="mb-1 truncate text-[8px] font-semibold uppercase tracking-wide sm:text-[9px]" style={{ color: secondaryColor }}>{headerText || "Your School"}</div>
      <div className="mx-auto mb-2 h-px w-1/2" style={{ backgroundColor: secondaryColor }} />
      <div className="line-clamp-2 text-[10px] font-bold leading-tight sm:text-xs" style={{ color: primaryColor }}>{title}</div>
      <p className="mt-2 line-clamp-3 text-[7px] leading-relaxed text-slate-600 sm:text-[8px]">
        {renderMockTokens(body)}
      </p>
      <div className="mt-2 flex items-center justify-between border-t pt-1" style={{ borderColor: `${secondaryColor}80` }}>
        <span className="text-[6px] text-slate-500 sm:text-[7px]">School Director</span>
        <span className="h-4 w-4 rounded-full border sm:h-5 sm:w-5" style={{ borderColor: secondaryColor }} />
      </div>
    </div>
  );
}

function renderMockTokens(text: string) {
  const mockValues: Record<string, string> = {
    student_name: "Aline Uwimana",
    gender: "Female",
    class_level: "Senior 3",
    academic_year: "2026/2027",
    conduct_score: "92/100",
    issue_date: "8 November 2026",
    school_name: "Your School",
    class: "Senior 3",
    date: "8 November 2026",
  };
  return text.replace(/\{\{([a-z_]+)\}\}|\{([a-z_]+)\}/gi, (_token, doubleBrace: string | undefined, singleBrace: string | undefined) => mockValues[(doubleBrace ?? singleBrace ?? "").toLowerCase()] ?? "");
}

function positionColumn(position: CertificateTemplate["signature_position"]) {
  return position === "center" ? 2 : position === "right" ? 3 : 1;
}

function PositionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "left" | "center" | "right";
  onChange: (value: "left" | "center" | "right") => void;
}) {
  return (
    <label className="block text-xs font-semibold text-soft">
      {label}
      <select className={`${inp} mt-1`} value={value} onChange={(e) => onChange(e.target.value as "left" | "center" | "right")}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
    </label>
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

  const activatePresetMutation = useMutation({
    mutationFn: async (preset: (typeof PRESETS)[number]) => {
      const existing = templates?.find((template) => template.name === preset.name);
      let designOptionsSaved = true;
      if (existing) {
        const result = await updateCertificateTemplate({
          data: { id: existing.id, ...preset, is_active: true },
        } as never);
        designOptionsSaved = result.design_options_saved;
      } else {
        const created = await createCertificateTemplate({
          data: { ...preset, show_signature: true, show_stamp: true, show_qr: true },
        } as never) as CertificateTemplate & { design_options_saved?: boolean };
        designOptionsSaved = created.design_options_saved !== false;
      }

      for (const template of templates ?? []) {
        if (template.is_active && template.id !== existing?.id) {
          await updateCertificateTemplate({ data: { id: template.id, is_active: false } } as never);
        }
      }
      return { designOptionsSaved };
    },
    onSuccess: ({ designOptionsSaved }) => {
      if (designOptionsSaved) toast.success("Preset activated");
      else toast.warning("Preset activated, but advanced design options were not saved. Run the certificate design SQL script first.");
      void qc.invalidateQueries({ queryKey: ["certificate-templates-all", schoolId] });
      void qc.invalidateQueries({ queryKey: ["certificate-templates", schoolId] });
    },
    onError: (error: Error) => toast.error(error.message),
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
      <section className={panel}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Preset gallery</p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">Start with a design</h2>
            <p className="mt-1 max-w-2xl text-sm text-soft">Preview each certificate with sample student details, then activate a design in one step.</p>
          </div>
          <button onClick={() => setCreatingNew(true)} className={`${btn} w-full sm:w-auto`}>Build from scratch</button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PRESETS.map((preset) => {
            const active = templates?.some((template) => template.name === preset.name && template.is_active);
            return (
              <article key={preset.name} className="min-w-0 overflow-hidden rounded-2xl border border-glass-line bg-glass-soft p-3">
                <TemplateMockPreview
                  title={preset.title}
                  body={preset.body}
                  headerText={preset.header_text}
                  primaryColor={preset.accent_color}
                  secondaryColor={preset.secondary_color}
                  borderStyle={preset.border_style}
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-ink">{preset.name}</h3>
                    <p className="text-xs text-soft">{preset.border_style} border</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => activatePresetMutation.mutate(preset)}
                    disabled={activatePresetMutation.isPending || active}
                    className={`${active ? "rounded-xl bg-ok/10 px-3 py-2 text-xs font-semibold text-ok" : "rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-on-brand"} shrink-0 disabled:opacity-60`}
                  >
                    {active ? "Active" : activatePresetMutation.isPending ? "Activating..." : "Use preset"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Your templates</h2>
          <p className="mt-1 text-sm text-soft">Edit a preset or create a school-specific design. Only active templates can be used to issue certificates.</p>
        </div>

        {templates && templates.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {templates.map((template) => (
              <div key={template.id} className={`${panel} p-4 sm:p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-base font-bold text-ink">{template.name}</h3>
                    <p className="mt-1 text-xs capitalize text-soft">{template.kind.replaceAll("_", " ")} · {template.orientation} · {template.border_style}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${template.is_active ? "bg-ok/20 text-ok" : "bg-gray-200 text-gray-600"}`}>
                        {template.is_active ? "Active" : "Inactive"}
                      </span>
                      <span className="h-4 w-4 rounded-full border-2" style={{ borderColor: template.accent_color, backgroundColor: template.accent_color }} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button onClick={() => setEditingTemplate(template)} className="rounded-xl bg-glass-bright px-3 py-2 text-xs font-semibold text-ink ring-1 ring-hairline">Edit design</button>
                    <button onClick={() => toggleActiveMutation.mutate(template)} disabled={toggleActiveMutation.isPending} className="rounded-xl bg-glass-bright px-3 py-2 text-xs font-semibold text-ink ring-1 ring-hairline disabled:opacity-50">
                      {template.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={panel}>
            <p className="text-center text-sm text-soft">No saved templates yet. Activate a preset above or create a new template.</p>
          </div>
        )}
      </section>

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
  const { data: school } = useSchoolSettings();
  const qc = useQueryClient();
  const isNew = !template;
  const [uploadingBranding, setUploadingBranding] = useState(false);

  const [formData, setFormData] = useState<Partial<CertificateTemplate>>({
    name: template?.name ?? "",
    kind: template?.kind ?? "good_deed",
    title: template?.title ?? "Certificate of Good Conduct",
    body: template?.body ?? "",
    accent_color: template?.accent_color ?? "#3b82f6",
    secondary_color: template?.secondary_color ?? "#b89155",
    header_text: template?.header_text ?? "",
    border_style: template?.border_style ?? "classic",
    orientation: template?.orientation ?? "landscape",
    show_signature: template?.show_signature ?? true,
    show_stamp: template?.show_stamp ?? true,
    show_qr: template?.show_qr ?? true,
    signature_position: template?.signature_position ?? "left",
    stamp_position: template?.stamp_position ?? "center",
    qr_position: template?.qr_position ?? "right",
  });

  const { data: signatureUrl } = useQuery({
    queryKey: ["certificate-signature-preview", schoolId, school?.signature_path],
    queryFn: async () => {
      if (!school?.signature_path) return null;
      return (await getCertificateBrandingUrl({ data: { path: school.signature_path } } as never)).url;
    },
    enabled: !!school?.signature_path,
  });
  const { data: stampUrl } = useQuery({
    queryKey: ["certificate-stamp-preview", schoolId, school?.stamp_path],
    queryFn: async () => {
      if (!school?.stamp_path) return null;
      return (await getCertificateBrandingUrl({ data: { path: school.stamp_path } } as never)).url;
    },
    enabled: !!school?.stamp_path,
  });

  async function uploadBranding(type: "signature" | "stamp", file?: File) {
    if (!file) return;
    if (file.type !== "image/png") {
      toast.error("Choose a PNG image. Signature and stamp uploads are stored as PNG.");
      return;
    }
    setUploadingBranding(true);
    try {
      await uploadCertificateBranding({
        data: { type, file_data: await fileToDataUrl(file), file_name: file.name },
      } as never);
      await qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
      toast.success(type === "signature" ? "Signature uploaded" : "School stamp uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally {
      setUploadingBranding(false);
    }
  }

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
    onSuccess: (result) => {
      const designOptionsSaved = !("design_options_saved" in result) || result.design_options_saved !== false;
      if (designOptionsSaved) toast.success(isNew ? "Template created" : "Template updated");
      else toast.warning("Template saved, but advanced design options were not saved. Run the certificate design SQL script first.");
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
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <style>{`@media print { @page { size: A4 ${formData.orientation ?? "landscape"}; margin: 0; } body * { visibility: hidden !important; } .certificate-print-preview, .certificate-print-preview * { visibility: visible !important; } .certificate-print-preview { position: fixed !important; inset: 0 !important; width: 100% !important; min-height: 100vh !important; margin: 0 !important; padding: 28px !important; box-shadow: none !important; } }`}</style>
        <DialogHeader>
          <DialogTitle>{isNew ? "Create Certificate Template" : "Edit Template"}</DialogTitle>
          <DialogDescription>
            Customize the certificate and preview the print layout as you edit. Dynamic fields include {"{{student_name}}"}, {"{{gender}}"}, {"{{class_level}}"}, {"{{academic_year}}"}, {"{{conduct_score}}"}, and {"{{issue_date}}"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-semibold text-soft">
              Template name
              <input className={`${inp} mt-1`} value={formData.name ?? ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Certificate of Good Conduct" />
            </label>
            <label className="block text-xs font-semibold text-soft">
              Certificate type
              <select className={`${inp} mt-1`} value={formData.kind ?? "good_deed"} onChange={(e) => setFormData({ ...formData, kind: e.target.value as CertificateTemplate["kind"] })}>
                <option value="good_deed">Good Deed</option>
                <option value="student_of_period">Student of the Month/Term</option>
                <option value="graduation">Graduation</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-soft">
              Header text
              <input className={`${inp} mt-1`} value={formData.header_text ?? ""} onChange={(e) => setFormData({ ...formData, header_text: e.target.value })} placeholder={school?.school_name ?? "Your School"} />
            </label>
            <label className="block text-xs font-semibold text-soft">
              Certificate title
              <input className={`${inp} mt-1`} value={formData.title ?? ""} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Certificate of Good Conduct" />
            </label>
          </div>

          <label className="block text-xs font-semibold text-soft">
            Certificate wording
            <textarea className={`${inp} mt-1`} rows={4} value={formData.body ?? ""} onChange={(e) => setFormData({ ...formData, body: e.target.value })} placeholder="This is to certify that {{student_name}}..." />
          </label>
          <p className="-mt-2 text-xs text-faint">
            Tokens: {"{{student_name}}"}, {"{{gender}}"}, {"{{class_level}}"}, {"{{academic_year}}"}, {"{{conduct_score}}"}, {"{{issue_date}}"}.
          </p>

          <div className="grid gap-4 rounded-2xl border border-glass-line bg-glass-soft p-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Director signature</h3>
              <p className="mt-1 text-xs text-soft">{school?.signature_path ? "A school signature is saved." : "No signature uploaded yet."}</p>
              <label className="mt-2 block text-xs text-soft">
                Upload PNG
                <input type="file" accept="image/png" disabled={uploadingBranding} onChange={(e) => void uploadBranding("signature", e.target.files?.[0])} className="mt-1 block w-full text-xs" />
              </label>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">School stamp</h3>
              <p className="mt-1 text-xs text-soft">{school?.stamp_path ? "A school stamp is saved." : "No stamp uploaded yet."}</p>
              <label className="mt-2 block text-xs text-soft">
                Upload PNG
                <input type="file" accept="image/png" disabled={uploadingBranding} onChange={(e) => void uploadBranding("stamp", e.target.files?.[0])} className="mt-1 block w-full text-xs" />
              </label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-soft">
              Primary color
              <input type="color" className="mt-1 h-10 w-full rounded-xl border border-input" value={formData.accent_color ?? "#3b82f6"} onChange={(e) => setFormData({ ...formData, accent_color: e.target.value })} />
            </label>
            <label className="block text-xs font-semibold text-soft">
              Secondary color
              <input type="color" className="mt-1 h-10 w-full rounded-xl border border-input" value={formData.secondary_color ?? "#b89155"} onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })} />
            </label>
            <label className="block text-xs font-semibold text-soft">
              Border style
              <select className={`${inp} mt-1`} value={formData.border_style ?? "classic"} onChange={(e) => setFormData({ ...formData, border_style: e.target.value as CertificateTemplate["border_style"] })}>
                <option value="classic">Classic Gold</option>
                <option value="modern">Modern Clean</option>
                <option value="minimal">Minimalist</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-soft">
              Orientation
              <select className={`${inp} mt-1`} value={formData.orientation ?? "landscape"} onChange={(e) => setFormData({ ...formData, orientation: e.target.value as CertificateTemplate["orientation"] })}>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <PositionField label="Signature position" value={formData.signature_position ?? "left"} onChange={(value) => setFormData({ ...formData, signature_position: value })} />
            <PositionField label="Stamp position" value={formData.stamp_position ?? "center"} onChange={(value) => setFormData({ ...formData, stamp_position: value })} />
            <PositionField label="QR authenticity stamp" value={formData.qr_position ?? "right"} onChange={(value) => setFormData({ ...formData, qr_position: value })} />
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={formData.show_signature ?? true} onChange={(e) => setFormData({ ...formData, show_signature: e.target.checked })} />Show signature</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={formData.show_stamp ?? true} onChange={(e) => setFormData({ ...formData, show_stamp: e.target.checked })} />Show school stamp</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={formData.show_qr ?? true} onChange={(e) => setFormData({ ...formData, show_qr: e.target.checked })} />Show QR verification code</label>
          </div>

          <div>
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink">Live print preview</h3>
                <p className="text-xs text-soft">Sample data is for layout only; the QR code is not an issued certificate.</p>
              </div>
              <button type="button" onClick={() => window.print()} className="rounded-xl bg-glass-bright px-3 py-2 text-xs font-semibold text-ink ring-1 ring-hairline">Print / Save as PDF</button>
            </div>
            <div className={`certificate-print-preview ${formData.border_style === "classic" ? "border-double border-4" : formData.border_style === "modern" ? "border-2 bg-gradient-to-br from-white to-gray-50" : "border"} bg-white p-5 text-slate-800 sm:p-8`} style={{ borderColor: formData.accent_color ?? "#3b82f6" }}>
              <div className="text-center">
                {school?.logo_url && <img src={school.logo_url} alt="School logo" className="mx-auto mb-2 h-12 w-12 object-contain" />}
                <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: formData.secondary_color ?? "#b89155" }}>{formData.header_text || school?.school_name || "Your School"}</p>
                <div className="my-3 border-y py-3" style={{ borderColor: formData.secondary_color ?? "#b89155" }}>
                  <h2 className="font-display text-2xl font-bold sm:text-3xl" style={{ color: formData.accent_color ?? "#3b82f6" }}>{renderMockTokens(formData.title ?? "Certificate title")}</h2>
                </div>
                <p className="mx-auto max-w-2xl whitespace-pre-line text-sm leading-relaxed sm:text-base">{renderMockTokens(formData.body ?? "Add certificate wording to preview sample data.")}</p>
              </div>
              <div className="mt-6 grid grid-cols-3 items-end gap-2 sm:mt-10 sm:gap-4">
                {formData.show_signature && <div className="flex flex-col items-center text-center" style={{ gridColumnStart: positionColumn(formData.signature_position) }}>
                  {signatureUrl ? <img src={signatureUrl} alt="Director signature" className="h-10 max-w-24 object-contain sm:h-14 sm:max-w-32" /> : <div className="h-8 w-20 border-b border-slate-400 sm:h-10 sm:w-28" />}
                  <span className="mt-1 text-[9px] text-slate-600 sm:text-xs">{school?.director_name || "School Director"}</span>
                </div>}
                {formData.show_stamp && <div className="flex justify-center" style={{ gridColumnStart: positionColumn(formData.stamp_position) }}>
                  {stampUrl ? <img src={stampUrl} alt="School stamp" className="h-12 w-12 object-contain opacity-80 sm:h-16 sm:w-16" /> : <div className="grid h-10 w-10 place-items-center rounded-full border text-[7px] text-slate-500 sm:h-14 sm:w-14 sm:text-[9px]" style={{ borderColor: formData.secondary_color ?? "#b89155" }}>SCHOOL STAMP</div>}
                </div>}
                {formData.show_qr && <div className="flex flex-col items-center gap-1" style={{ gridColumnStart: positionColumn(formData.qr_position) }}>
                  <QRCode value="SCDMS DESIGN PREVIEW - NOT AN ISSUED CERTIFICATE" size={56} className="h-10 w-10 sm:h-14 sm:w-14" />
                  <span className="text-[8px] text-slate-500">Preview QR</span>
                </div>}
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
