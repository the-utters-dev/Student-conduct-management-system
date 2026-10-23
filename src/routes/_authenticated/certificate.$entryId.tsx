import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { DashboardShell } from "@/components/DashboardShell";

// @ts-expect-error - route will be generated at build time
export const Route = createFileRoute("/_authenticated/certificate/$entryId")({
  component: CertificatePage,
});

function CertificatePage() {
  const params = Route.useParams() as { entryId: string };
  const { schoolId } = useAuth();
  const { data: school } = useSchoolSettings();

  const { data: entry, isLoading } = useQuery({
    queryKey: ["conduct-entry", params.entryId, schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("conduct_logs" as never) as any)
        .select(`
          id,
          occurred_on,
          details,
          students!inner(full_name, class_name, admission_no),
          good_deed_categories(name)
        `)
        .eq("id", params.entryId)
        .eq("school_id", schoolId)
        .eq("entry_type", "good_deed")
        .single();
      if (error) throw error;
      return data as {
        id: string;
        occurred_on: string;
        details: string | null;
        students: { full_name: string; class_name: string; admission_no: string };
        good_deed_categories: { name: string } | null;
      };
    },
    enabled: !!params.entryId && !!schoolId,
  });

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
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

  const schoolName = school?.school_name ?? "School";
  const logoUrl = school?.logo_url;
  const categoryName = entry.good_deed_categories?.name ?? entry.details ?? "Good Conduct";
  const date = new Date(entry.occurred_on).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
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
            <div className="flex items-center justify-between rounded-3xl border border-glass-line bg-glass p-4 shadow-panel backdrop-blur-2xl">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">
                  Certificate for {entry.students.full_name}
                </h2>
                <p className="text-sm text-soft">{categoryName} · {date}</p>
              </div>
              <button
                onClick={handlePrint}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow"
              >
                Print / Save as PDF
              </button>
            </div>

            <div className="certificate-preview rounded-3xl border border-glass-line bg-white p-8 shadow-panel sm:p-12">
              <CertificateContent
                schoolName={schoolName}
                logoUrl={logoUrl}
                studentName={entry.students.full_name}
                className={entry.students.class_name}
                categoryName={categoryName}
                date={date}
                details={entry.details}
              />
            </div>
          </div>
        </DashboardShell>
      </div>

      <div className="print-only certificate-wrapper">
        <div className="certificate-content">
          <CertificateContent
            schoolName={schoolName}
            logoUrl={logoUrl}
            studentName={entry.students.full_name}
            className={entry.students.class_name}
            categoryName={categoryName}
            date={date}
            details={entry.details}
          />
        </div>
      </div>
    </>
  );
}

function CertificateContent({
  schoolName,
  logoUrl,
  studentName,
  className: studentClass,
  categoryName,
  date,
  details,
}: {
  schoolName: string;
  logoUrl: string | null | undefined;
  studentName: string;
  className: string;
  categoryName: string;
  date: string;
  details: string | null;
}) {
  return (
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
          <p className="text-sm text-soft">School Conduct & Discipline Management</p>
        </div>
      </div>

      {/* Certificate title */}
      <div className="mb-8 w-full border-b-2 border-t-2 border-brand py-4">
        <h2 className="font-display text-4xl font-bold text-brand">
          Certificate of Good Conduct
        </h2>
      </div>

      {/* Certificate body */}
      <div className="mb-8 max-w-2xl space-y-6">
        <p className="text-lg text-ink">This is to certify that</p>

        <p className="font-display text-3xl font-bold text-ink">{studentName}</p>

        <p className="text-lg text-ink">
          of <span className="font-semibold">{studentClass}</span>
        </p>

        <p className="text-lg text-ink">
          has been recognised for demonstrating
        </p>

        <p className="font-display text-2xl font-bold text-ok">{categoryName}</p>

        {details && (
          <p className="italic text-soft">{details}</p>
        )}

        <p className="text-lg text-ink">
          on <span className="font-semibold">{date}</span>
        </p>

        <p className="mt-8 text-base text-soft">
          This certificate is awarded in recognition of exemplary conduct and positive behaviour.
          We commend this student for their outstanding character and encourage them to continue
          setting a positive example for their peers.
        </p>
      </div>

      {/* Signature line */}
      <div className="mt-12 flex w-full max-w-md flex-col items-center">
        <div className="h-px w-full bg-ink/30"></div>
        <p className="mt-2 text-sm font-semibold text-ink">School Director</p>
        <p className="text-xs text-soft">{schoolName}</p>
      </div>

      {/* Footer */}
      <div className="mt-8 text-xs text-faint">
        Generated by SCDMS · {new Date().toLocaleDateString("en-GB")}
      </div>
    </div>
  );
}
