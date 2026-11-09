import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { DashboardShell } from "@/components/DashboardShell";
import { QRCode } from "@/components/QRCode";
import { renderCertificateTemplateText } from "@/lib/certificate-template";
import {
  getCertificateBrandingUrl,
  issueCertificate,
  checkExistingCertificate,
  type CertificateTemplate,
  type IssuedCertificate
} from "@/lib/certificate.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/certificate/$entryId")({
  component: CertificatePage,
});

function CertificatePage() {
  const params = Route.useParams() as { entryId: string };
  const { schoolId, isSchoolDirector, isPlatformAdmin, role } = useAuth();
  const { data: school } = useSchoolSettings();
  const qc = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Mirrors requireCertificateIssuer in certificate.functions.ts (Director or Master of Discipline).
  const canIssue = isSchoolDirector || isPlatformAdmin || role === "master_of_discipline";

  const { data: entry, isLoading: entryLoading } = useQuery({
    queryKey: ["conduct-entry", params.entryId, schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("conduct_logs" as never) as any)
        .select(`
          id,
          occurred_on,
          reason,
          good_deed_category_id,
          student_id,
          students!inner(id, full_name, class_name, admission_no, gender),
          good_deed_categories(name)
        `)
        .eq("id", params.entryId)
        .eq("entry_type", "good_deed")
        .single();
      if (error) throw error;
      return data as {
        id: string;
        occurred_on: string;
        reason: string | null;
        good_deed_category_id: string | null;
        student_id: string;
        students: { id: string; full_name: string; class_name: string; admission_no: string; gender: string | null };
        good_deed_categories: { name: string } | null;
      };
    },
    enabled: !!params.entryId && !!schoolId,
  });

  // Fetch active templates for this school
  const { data: templates } = useQuery({
    queryKey: ["certificate-templates", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("certificate_templates" as never) as any)
        .select("*")
        .eq("is_active", true)
        .eq("kind", "good_deed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CertificateTemplate[];
    },
    enabled: !!schoolId,
  });

  // Auto-select first template
  const activeTemplateId = selectedTemplateId ?? templates?.[0]?.id ?? null;
  const activeTemplate = templates?.find(t => t.id === activeTemplateId);

  // Check for existing issued certificate for this entry and template
  const { data: existingCertificate, isLoading: checkingExisting } = useQuery({
    queryKey: ["existing-certificate", entry?.student_id, activeTemplateId, params.entryId],
    queryFn: async () => {
      if (!entry || !activeTemplateId) return null;
      return await checkExistingCertificate({
        data: {
          conduct_log_id: params.entryId,
          student_id: entry.student_id,
          template_id: activeTemplateId,
        },
      } as never);
    },
    enabled: !!entry && !!activeTemplateId && canIssue,
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!entry || !activeTemplateId || !activeTemplate) {
        throw new Error("Missing required data to issue certificate");
      }

      const categoryName = entry.good_deed_categories?.name ?? entry.reason ?? "Good Conduct";
      const date = new Date(entry.occurred_on).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const issueDate = new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      return await issueCertificate({
        data: {
          template_id: activeTemplateId,
          student_id: entry.student_id,
          conduct_log_id: params.entryId,
          data: {
            school_name: school?.school_name ?? "School",
            student_name: entry.students.full_name,
            gender: entry.students.gender ?? "",
            class: entry.students.class_name,
            class_level: entry.students.class_name,
            admission_no: entry.students.admission_no,
            category: categoryName,
            details: entry.reason ?? "",
            date,
            issue_date: issueDate,
            certificate_title: activeTemplate.title,
            director_name: school?.director_name ?? "",
            academic_year: school?.academic_year ?? "",
            conduct_score: "N/A",
          },
        },
      } as never);
    },
    onSuccess: () => {
      toast.success("Certificate issued successfully");
      void qc.invalidateQueries({ queryKey: ["existing-certificate"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handlePrint = () => {
    window.print();
  };

  if (entryLoading) {
    return (
      <DashboardShell greeting="Certificate" dateLine="Certificate of Good Conduct">
        <div className="rounded-3xl border border-glass-line bg-glass p-6 text-center shadow-panel backdrop-blur-2xl">
          <p className="text-sm text-soft">Loading certificate...</p>
        </div>
      </DashboardShell>
    );
  }

  if (!entry) {
    return (
      <DashboardShell greeting="Certificate" dateLine="Certificate of Good Conduct">
        <div className="rounded-3xl border border-glass-line bg-glass p-6 text-center shadow-panel backdrop-blur-2xl">
          <p className="text-sm text-danger">Certificate not found or not accessible.</p>
        </div>
      </DashboardShell>
    );
  }

  if (!activeTemplate) {
    return (
      <DashboardShell greeting="Certificate" dateLine="Certificate of Good Conduct">
        <div className="rounded-3xl border border-glass-line bg-glass p-6 text-center shadow-panel backdrop-blur-2xl">
          <p className="text-sm text-soft">No active certificate templates found. Please create a template in Settings.</p>
        </div>
      </DashboardShell>
    );
  }

  const categoryName = entry.good_deed_categories?.name ?? entry.reason ?? "Good Conduct";
  const date = new Date(entry.occurred_on).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const isIssued = !!existingCertificate;
  const verificationUrl = existingCertificate?.verification_code
    ? `${window.location.origin}/verify/${existingCertificate.verification_code}`
    : undefined;

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: A4 ${activeTemplate.orientation};
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
          }
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .certificate-wrapper {
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
          }
          .certificate-content {
            width: 100%;
            max-width: 1000px;
            padding: 60px 80px;
          }
        }
        .print-only {
          display: none;
        }
      `}</style>

      <div className="no-print">
        <DashboardShell greeting="Certificate" dateLine="Certificate of Good Conduct">
          <div className="space-y-4">
            <div className="flex flex-col gap-4 rounded-3xl border border-glass-line bg-glass p-4 shadow-panel backdrop-blur-2xl sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <h2 className="font-display text-lg font-bold text-ink">
                  Certificate for {entry.students.full_name}
                </h2>
                <p className="text-sm text-soft">{categoryName} · {date}</p>
                {isIssued && (
                  <p className="mt-1 text-xs font-semibold text-ok">
                    Issued: {existingCertificate.serial_no}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {canIssue && !isIssued && (
                  <button
                    onClick={() => issueMutation.mutate()}
                    disabled={issueMutation.isPending || checkingExisting}
                    className="rounded-xl bg-ok px-4 py-2 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
                  >
                    {issueMutation.isPending ? "Issuing..." : "Issue Certificate"}
                  </button>
                )}
                <button
                  onClick={handlePrint}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow"
                >
                  Print / Save as PDF
                </button>
              </div>
            </div>

            {templates && templates.length > 1 && (
              <div className="rounded-3xl border border-glass-line bg-glass p-4 shadow-panel backdrop-blur-2xl">
                <label className="block text-xs font-semibold text-soft">
                  Certificate Template
                  <select
                    className="mt-2 w-full rounded-xl border border-glass-line bg-glass-bright px-3 py-2 text-sm text-ink focus:ring-2 focus:ring-brand"
                    value={activeTemplateId ?? ""}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="certificate-preview rounded-3xl border border-glass-line bg-white p-8 shadow-panel sm:p-12">
              <CertificateContent
                template={activeTemplate}
                school={school}
                studentName={entry.students.full_name}
                gender={entry.students.gender ?? ""}
                studentClass={entry.students.class_name}
                academicYear={school?.academic_year ?? ""}
                admissionNo={entry.students.admission_no}
                categoryName={categoryName}
                date={date}
                reason={entry.reason}
                issuedCertificate={existingCertificate}
                verificationUrl={verificationUrl}
              />
            </div>
          </div>
        </DashboardShell>
      </div>

      <div className="print-only certificate-wrapper">
        <div className="certificate-content">
          <CertificateContent
            template={activeTemplate}
            school={school}
            studentName={entry.students.full_name}
            gender={entry.students.gender ?? ""}
            studentClass={entry.students.class_name}
            academicYear={school?.academic_year ?? ""}
            admissionNo={entry.students.admission_no}
            categoryName={categoryName}
            date={date}
            reason={entry.reason}
            issuedCertificate={existingCertificate}
            verificationUrl={verificationUrl}
          />
        </div>
      </div>
    </>
  );
}

function CertificateContent({
  template,
  school,
  studentName,
  gender,
  studentClass,
  academicYear,
  admissionNo,
  categoryName,
  date,
  reason,
  issuedCertificate,
  verificationUrl,
}: {
  template: CertificateTemplate;
  school: any;
  studentName: string;
  gender: string;
  studentClass: string;
  academicYear: string;
  admissionNo: string;
  categoryName: string;
  date: string;
  reason: string | null;
  issuedCertificate: IssuedCertificate | null | undefined;
  verificationUrl?: string | undefined;
}) {
  const { schoolId } = useAuth();
  const { data: signatureUrl } = useQuery({
    queryKey: ["signature-url", schoolId, school?.signature_path],
    queryFn: async () => {
      if (!school?.signature_path) return null;
      const result = await getCertificateBrandingUrl({ data: { path: school.signature_path } } as never);
      return result.url;
    },
    enabled: !!school?.signature_path && template.show_signature,
  });

  const { data: stampUrl } = useQuery({
    queryKey: ["stamp-url", schoolId, school?.stamp_path],
    queryFn: async () => {
      if (!school?.stamp_path) return null;
      const result = await getCertificateBrandingUrl({ data: { path: school.stamp_path } } as never);
      return result.url;
    },
    enabled: !!school?.stamp_path && template.show_stamp,
  });

  const schoolName = school?.school_name ?? "School";
  const logoUrl = school?.logo_url;

  const certificateData = issuedCertificate?.data ?? {};
  const tokenValues = {
    student_name: studentName,
    gender: String(certificateData.gender ?? gender),
    class: studentClass,
    class_level: studentClass,
    admission_no: admissionNo,
    category: categoryName,
    details: reason ?? "",
    date,
    issue_date: String(certificateData.issue_date ?? (issuedCertificate ? new Date(issuedCertificate.issued_at).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB"))),
    school_name: schoolName,
    director_name: school?.director_name ?? "School Director",
    conduct_score: String(certificateData.conduct_score ?? "N/A"),
    max_marks: String(certificateData.max_marks ?? "N/A"),
    term: String(certificateData.term ?? "N/A"),
    academic_year: String(certificateData.academic_year ?? academicYear ?? new Date().getFullYear()),
    certificate_title: String(certificateData.certificate_title ?? template.title),
  };
  const renderedTitle = renderCertificateTemplateText(template.title, tokenValues);
  const renderedBody = renderCertificateTemplateText(template.body, tokenValues);
  const renderedHeader = renderCertificateTemplateText(template.header_text || schoolName, tokenValues);

  // Border style classes
  const borderClass =
    template.border_style === "classic" ? "border-4 border-double" :
    template.border_style === "modern" ? "border-2 bg-gradient-to-br from-white to-gray-50" :
    "border";

  return (
    <div className={`${borderClass} p-8`} style={{ borderColor: template.secondary_color ?? template.accent_color }}>
      <div className="flex flex-col items-center text-center">
        {/* Header with logo */}
        <div className="mb-8 flex items-center gap-4">
          {logoUrl && (
            <img
              src={logoUrl}
              alt={`${schoolName} logo`}
              className="h-20 w-20 object-contain"
            />
          )}
          <div>
            <h1 className="font-display text-3xl font-bold text-ink">{schoolName}</h1>
            <p className="text-sm text-soft">{renderedHeader}</p>
          </div>
        </div>

        {/* Certificate title */}
        <div className="mb-8 w-full border-b-2 border-t-2 py-4" style={{ borderColor: template.secondary_color ?? template.accent_color }}>
          <h2 className="font-display text-4xl font-bold" style={{ color: template.accent_color }}>
            {renderedTitle}
          </h2>
        </div>

        {/* Certificate body (preserve line breaks) */}
        <div className="mb-8 max-w-2xl whitespace-pre-line text-lg text-ink">
          {renderedBody}
        </div>

        {/* Signature and Stamp */}
        <div className="mt-12 grid w-full max-w-3xl grid-cols-3 items-end gap-3">
          {template.show_signature && (
            <div className="relative flex flex-col items-center text-center" style={{ gridColumnStart: certificatePositionColumn(template.signature_position ?? "left") }}>
              {signatureUrl ? (
                <img src={signatureUrl} alt="Director signature" className="h-auto w-40 max-w-full object-contain" />
              ) : (
                <div className="h-16 w-48 border-b border-ink/30" />
              )}
              <p className="mt-2 text-sm font-semibold text-ink">
                {school?.director_name ?? "School Director"}
              </p>
              <p className="text-xs text-soft">{school?.director_title ?? "School Director"}</p>
              <p className="text-xs text-soft">{schoolName}</p>
            </div>
          )}

          {template.show_stamp && stampUrl && (
            <div className="flex justify-center" style={{ gridColumnStart: certificatePositionColumn(template.stamp_position ?? "center") }}>
              <img src={stampUrl} alt="School stamp" className="h-16 w-16 object-contain opacity-80" />
            </div>
          )}

          {(template.show_qr ?? true) && issuedCertificate && verificationUrl && (
            <div className="flex flex-col items-center gap-2" style={{ gridColumnStart: certificatePositionColumn(template.qr_position ?? "right") }}>
              <QRCode value={verificationUrl} size={80} />
              <p className="text-xs font-mono text-faint">{issuedCertificate.serial_no}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-xs text-faint">
          Generated by SCDMS · {new Date().toLocaleDateString("en-GB")}
          {issuedCertificate && (
            <span className="ml-2">
              · Verify at {window.location.host}/verify/{issuedCertificate.verification_code}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function certificatePositionColumn(position: CertificateTemplate["signature_position"]) {
  return position === "center" ? 2 : position === "right" ? 3 : 1;
}
