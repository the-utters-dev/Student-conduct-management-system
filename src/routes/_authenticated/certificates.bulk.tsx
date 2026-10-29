import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import {
  type CertificateTemplate,
  bulkIssueCertificates,
} from "@/lib/certificate.functions";
import { QRCode } from "@/components/QRCode";

export const Route = createFileRoute("/_authenticated/certificates/bulk")({
  component: BulkCertificatesPage,
});

const panel = "rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl";
const inp = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-ink outline-none";
const btn = "rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-60";

interface Student {
  id: string;
  full_name: string;
  class_name: string;
  admission_no: string;
  conduct_score?: number;
}

function BulkCertificatesPage() {
  const { schoolId } = useAuth();
  const { data: school } = useSchoolSettings();
  const qc = useQueryClient();

  const [mode, setMode] = useState<"graduation" | "custom">("graduation");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [minConductScore, setMinConductScore] = useState(70);
  const [excludeCritical, setExcludeCritical] = useState(true);
  const [issued, setIssued] = useState<any[] | null>(null);

  // Fetch templates
  const { data: templates } = useQuery({
    queryKey: ["certificate-templates", schoolId, mode],
    queryFn: async () => {
      const { data, error } = await (supabase.from("certificate_templates" as never) as any)
        .select("*")
        .eq("is_active", true)
        .eq("kind", mode === "graduation" ? "graduation" : mode)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CertificateTemplate[];
    },
    enabled: !!schoolId,
  });

  // Fetch S6 students for graduation mode
  const { data: s6Students, isLoading: loadingS6 } = useQuery({
    queryKey: ["s6-students", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("students" as never) as any)
        .select("id, full_name, class_name, admission_no")
        .ilike("class_name", "%S6%")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data as Student[];
    },
    enabled: !!schoolId && mode === "graduation",
  });

  // Fetch all students for custom mode
  const { data: allStudents, isLoading: loadingAll } = useQuery({
    queryKey: ["all-students", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("students" as never) as any)
        .select("id, full_name, class_name, admission_no")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data as Student[];
    },
    enabled: !!schoolId && mode === "custom",
  });

  const students = mode === "graduation" ? s6Students : allStudents;
  const loading = mode === "graduation" ? loadingS6 : loadingAll;

  // Filter eligible students for graduation
  const eligibleStudents = mode === "graduation"
    ? students?.filter((s) => {
        const meetsScore = !minConductScore || (s.conduct_score ?? 0) >= minConductScore;
        const notCritical = !excludeCritical; // TODO: check critical standing from database
        return meetsScore && notCritical;
      })
    : students;

  const activeTemplate = templates?.find(t => t.id === selectedTemplateId) ?? templates?.[0];

  const bulkIssueMutation = useMutation({
    mutationFn: async () => {
      if (!activeTemplate || selectedStudents.size === 0) {
        throw new Error("Please select a template and at least one student");
      }

      const studentsToIssue = students?.filter(s => selectedStudents.has(s.id)) ?? [];

      return await bulkIssueCertificates({
        data: {
          template_id: activeTemplate.id,
          students: studentsToIssue.map((s) => ({
            student_id: s.id,
            data: {
              school_name: school?.school_name ?? "School",
              student_name: s.full_name,
              class: s.class_name,
              admission_no: s.admission_no,
              conduct_score: s.conduct_score?.toString() ?? "N/A",
              max_marks: "100",
              academic_year: new Date().getFullYear().toString(),
              certificate_title: activeTemplate.title,
              director_name: school?.director_name ?? "",
            },
          })),
        },
      } as never);
    },
    onSuccess: (data) => {
      toast.success(`${data.count} certificates issued successfully`);
      setIssued(data.certificates);
      void qc.invalidateQueries({ queryKey: ["issued-certificates", schoolId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleStudent = (studentId: string) => {
    const newSet = new Set(selectedStudents);
    if (newSet.has(studentId)) {
      newSet.delete(studentId);
    } else {
      newSet.add(studentId);
    }
    setSelectedStudents(newSet);
  };

  const selectAll = () => {
    const newSet = new Set((eligibleStudents ?? []).map(s => s.id));
    setSelectedStudents(newSet);
  };

  const deselectAll = () => {
    setSelectedStudents(new Set());
  };

  if (issued) {
    // Show printable page with all certificates
    return <BulkPrintView certificates={issued} template={activeTemplate!} school={school} />;
  }

  return (
    <DashboardShell greeting="Bulk Certificates" dateLine="Issue certificates to multiple students">
      <div className="space-y-4">
        <div className={panel}>
          <h3 className="font-display text-lg font-bold text-ink">Bulk Certificate Generation</h3>
          <p className="mt-1 text-sm text-soft">
            Select students and generate certificates for all at once. You can print or download all certificates in a single PDF.
          </p>
        </div>

        <div className={panel}>
          <div className="space-y-4">
            <label className="block text-xs font-semibold text-soft">
              Mode
              <select
                className={`${inp} mt-1`}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as any);
                  setSelectedStudents(new Set());
                }}
              >
                <option value="graduation">S6 Graduation (with eligibility rules)</option>
                <option value="custom">Custom (any students, any template)</option>
              </select>
            </label>

            {templates && templates.length > 0 ? (
              <label className="block text-xs font-semibold text-soft">
                Certificate Template
                <select
                  className={`${inp} mt-1`}
                  value={selectedTemplateId ?? templates[0]?.id ?? ""}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm text-soft">No templates found for {mode} mode. Please create a template first.</p>
            )}

            {mode === "graduation" && (
              <div className="space-y-3 rounded-xl bg-glass-bright p-4">
                <p className="text-xs font-semibold text-soft">Eligibility Rules for S6 Graduation</p>
                <label className="block text-xs font-semibold text-soft">
                  Minimum Final Conduct Score
                  <input
                    type="number"
                    className={`${inp} mt-1`}
                    value={minConductScore}
                    onChange={(e) => setMinConductScore(Number(e.target.value))}
                    min="0"
                    max="100"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={excludeCritical}
                    onChange={(e) => setExcludeCritical(e.target.checked)}
                  />
                  Exclude students with critical standing
                </label>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className={panel}>
            <p className="text-sm text-soft">Loading students...</p>
          </div>
        ) : eligibleStudents && eligibleStudents.length > 0 ? (
          <div className={panel}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-soft">
                {mode === "graduation" ? `${eligibleStudents.length} eligible S6 students` : `${eligibleStudents.length} students`}
              </p>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs font-semibold text-brand underline">
                  Select All
                </button>
                <button onClick={deselectAll} className="text-xs font-semibold text-soft underline">
                  Deselect All
                </button>
              </div>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto">
              {eligibleStudents.map((student) => (
                <label
                  key={student.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl bg-glass-bright p-3 hover:ring-2 hover:ring-brand"
                >
                  <input
                    type="checkbox"
                    checked={selectedStudents.has(student.id)}
                    onChange={() => toggleStudent(student.id)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-ink">{student.full_name}</p>
                    <p className="text-xs text-soft">
                      {student.class_name} · {student.admission_no}
                      {student.conduct_score !== undefined && ` · Score: ${student.conduct_score}`}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">{selectedStudents.size} students selected</p>
              <button
                onClick={() => bulkIssueMutation.mutate()}
                disabled={bulkIssueMutation.isPending || selectedStudents.size === 0 || !activeTemplate}
                className={btn}
              >
                {bulkIssueMutation.isPending ? "Generating..." : `Generate ${selectedStudents.size} Certificates`}
              </button>
            </div>
          </div>
        ) : (
          <div className={panel}>
            <p className="text-center text-sm text-soft">
              {mode === "graduation"
                ? "No eligible S6 students found. Adjust the eligibility rules or check your student data."
                : "No students found."}
            </p>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function BulkPrintView({
  certificates,
  template,
  school,
}: {
  certificates: any[];
  template: CertificateTemplate;
  school: any;
}) {
  return (
    <>
      <style>{`
        @media print {
          @page {
            size: A4 ${template.orientation};
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
          }
          .no-print {
            display: none !important;
          }
          .certificate-page {
            page-break-after: always;
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
          }
          .certificate-page:last-child {
            page-break-after: auto;
          }
        }
        @media screen {
          .certificate-page {
            margin-bottom: 2rem;
            padding: 2rem;
            border: 1px solid #e5e7eb;
          }
        }
      `}</style>

      <div className="no-print fixed left-0 right-0 top-0 z-50 bg-white p-4 shadow-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <p className="text-sm font-semibold text-ink">{certificates.length} certificates ready to print</p>
          <div className="flex gap-2">
            <button
              onClick={() => window.history.back()}
              className="rounded-xl bg-glass-bright px-4 py-2 text-sm font-semibold text-ink ring-1 ring-hairline"
            >
              Back
            </button>
            <button
              onClick={() => window.print()}
              className={btn}
            >
              Print All / Save as PDF
            </button>
          </div>
        </div>
      </div>

      <div className="pt-20">
        {certificates.map((cert, index) => (
          <div key={cert.id} className="certificate-page">
            <div className="w-full max-w-4xl">
              <CertificateContent
                template={template}
                school={school}
                certificate={cert}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CertificateContent({
  template,
  school,
  certificate,
}: {
  template: CertificateTemplate;
  school: any;
  certificate: any;
}) {
  const certData = certificate.data;
  const verificationUrl = `${window.location.origin}/verify/${certificate.verification_code}`;

  const replacePlaceholders = (text: string) => {
    return text
      .replace(/\{student_name\}/g, certData.student_name ?? "")
      .replace(/\{class\}/g, certData.class ?? "")
      .replace(/\{admission_no\}/g, certData.admission_no ?? "")
      .replace(/\{school_name\}/g, certData.school_name ?? "")
      .replace(/\{director_name\}/g, certData.director_name ?? "")
      .replace(/\{conduct_score\}/g, certData.conduct_score ?? "N/A")
      .replace(/\{max_marks\}/g, certData.max_marks ?? "100")
      .replace(/\{academic_year\}/g, certData.academic_year ?? "")
      .replace(/\{certificate_title\}/g, certData.certificate_title ?? "");
  };

  const renderedTitle = replacePlaceholders(template.title);
  const renderedBody = replacePlaceholders(template.body);

  const borderClass =
    template.border_style === "classic" ? "border-4 border-double" :
    template.border_style === "modern" ? "border-2 bg-gradient-to-br from-white to-gray-50" :
    "border";

  return (
    <div className={`${borderClass} p-8`} style={{ borderColor: template.accent_color }}>
      <div className="flex flex-col items-center text-center">
        <div className="mb-8 flex items-center gap-4">
          {school?.logo_url && (
            <img src={school.logo_url} alt="School logo" className="h-20 w-20 object-contain" />
          )}
          <div>
            <h1 className="font-display text-3xl font-bold text-ink">{school?.school_name ?? "School"}</h1>
            <p className="text-sm text-soft">School Conduct & Discipline Management</p>
          </div>
        </div>

        <div className="mb-8 w-full border-b-2 border-t-2 py-4" style={{ borderColor: template.accent_color }}>
          <h2 className="font-display text-4xl font-bold" style={{ color: template.accent_color }}>
            {renderedTitle}
          </h2>
        </div>

        <div className="mb-8 max-w-2xl whitespace-pre-line text-lg text-ink">
          {renderedBody}
        </div>

        <div className="mt-12 flex w-full max-w-lg items-end justify-between">
          {template.show_signature && (
            <div className="relative flex flex-col items-center">
              <div className="h-16 w-48 border-b border-ink/30" />
              <p className="mt-2 text-sm font-semibold text-ink">{school?.director_name ?? "School Director"}</p>
              <p className="text-xs text-soft">{school?.director_title ?? "School Director"}</p>
              <p className="text-xs text-soft">{school?.school_name ?? "School"}</p>
            </div>
          )}

          <div className="flex flex-col items-center gap-2">
            <QRCode value={verificationUrl} size={80} />
            <p className="text-xs font-mono text-faint">{certificate.serial_no}</p>
          </div>
        </div>

        <div className="mt-8 text-xs text-faint">
          Generated by SCDMS · {new Date().toLocaleDateString("en-GB")}
          <span className="ml-2">· Verify at {window.location.host}/verify/{certificate.verification_code}</span>
        </div>
      </div>
    </div>
  );
}
