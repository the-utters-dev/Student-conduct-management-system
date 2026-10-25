import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/evidence";

export const Route = createFileRoute('/verify/$code')({
  component: VerifyPage,
});

function VerifyPage() {
  const params = Route.useParams() as { code: string };

  const { data, isLoading, error } = useQuery({
    queryKey: ["verify-certificate", params.code],
    queryFn: async () => {
      const { data, error } = await db.rpc("verify_certificate", {
        _verification_code: params.code,
      });

      if (error) throw error;

      // The function returns a single row
      return data?.[0] as {
        is_valid: boolean;
        school_name: string | null;
        student_name: string | null;
        certificate_title: string | null;
        issued_date: string | null;
        status: string;
      } | null;
    },
    enabled: !!params.code,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand/10 to-accent/10 p-4">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-glass-line bg-glass p-8 text-center shadow-panel backdrop-blur-2xl">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-brand border-t-transparent" />
          <p className="text-sm text-soft">Verifying certificate...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-danger/10 to-warn/10 p-4">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-glass-line bg-glass p-8 text-center shadow-panel backdrop-blur-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-danger/20 text-3xl text-danger">
            ✕
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">Invalid Code</h1>
          <p className="text-sm text-soft">
            {error ? (error as Error).message : "The verification code you entered could not be found."}
          </p>
          <p className="text-xs text-faint">
            Please check the code and try again, or contact the school for assistance.
          </p>
        </div>
      </div>
    );
  }

  if (data.status === "not_found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-danger/10 to-warn/10 p-4">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-glass-line bg-glass p-8 text-center shadow-panel backdrop-blur-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-danger/20 text-3xl text-danger">
            ✕
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">Certificate Not Found</h1>
          <p className="text-sm text-soft">
            No certificate was found with this verification code.
          </p>
          <p className="text-xs text-faint">
            Please check the code and try again, or contact the school for assistance.
          </p>
        </div>
      </div>
    );
  }

  if (data.status === "revoked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-warn/10 to-danger/10 p-4">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-glass-line bg-glass p-8 text-center shadow-panel backdrop-blur-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-warn/20 text-3xl text-warn">
            ⚠
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">Certificate Revoked</h1>
          <p className="text-sm text-soft">
            This certificate has been revoked and is no longer valid.
          </p>
          <div className="mt-6 space-y-2 text-left">
            <p className="text-xs text-faint">
              <span className="font-semibold text-soft">School:</span> {data.school_name}
            </p>
            <p className="text-xs text-faint">
              <span className="font-semibold text-soft">Student:</span> {data.student_name}
            </p>
            <p className="text-xs text-faint">
              <span className="font-semibold text-soft">Certificate:</span> {data.certificate_title}
            </p>
            <p className="text-xs text-faint">
              <span className="font-semibold text-soft">Originally Issued:</span>{" "}
              {data.issued_date
                ? new Date(data.issued_date).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "Unknown"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Valid certificate
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ok/10 to-brand/10 p-4">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-glass-line bg-glass p-8 text-center shadow-panel backdrop-blur-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ok/20 text-3xl text-ok">
          ✓
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">Certificate Verified</h1>
        <p className="text-sm text-ok">This certificate is authentic and valid.</p>

        <div className="mt-6 space-y-3 rounded-2xl bg-glass-bright p-6 text-left">
          <div>
            <p className="text-xs font-semibold text-soft">School</p>
            <p className="text-base font-semibold text-ink">{data.school_name}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-soft">Student</p>
            <p className="text-base font-semibold text-ink">{data.student_name}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-soft">Certificate</p>
            <p className="text-base text-ink">{data.certificate_title}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-soft">Issued On</p>
            <p className="text-base text-ink">
              {data.issued_date
                ? new Date(data.issued_date).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "Unknown"}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl bg-glass-bright p-4">
          <p className="text-xs text-faint">
            This certificate was issued by {data.school_name} and verified through the SCDMS platform.
          </p>
        </div>
      </div>
    </div>
  );
}
