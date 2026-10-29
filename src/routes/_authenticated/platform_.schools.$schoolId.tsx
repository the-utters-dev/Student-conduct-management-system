import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getSchoolDetails,
  updateSchoolStatus,
  recordSchoolPayment,
  getSchoolPayments,
  createSupportNote,
  getSchoolSupportNotes,
  updateSupportNoteStatus,
  type SchoolStatus,
} from "@/lib/platform.functions";

export const Route = createFileRoute("/_authenticated/platform_/schools/$schoolId")({
  component: SchoolDetailPage,
});

const card = "rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl";
const field =
  "rounded-2xl bg-glass-bright px-3 py-2 text-sm text-body outline-none ring-1 ring-hairline focus:ring-2 focus:ring-brand/50";
const btn = "rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-60";

function SchoolDetailPage() {
  const { schoolId } = Route.useParams();
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const getDetailsFn = useServerFn(getSchoolDetails);
  const updateStatusFn = useServerFn(updateSchoolStatus);

  const [tab, setTab] = useState<"overview" | "staff" | "subscription" | "support">("overview");

  const { data: school, isLoading } = useQuery({
    queryKey: ["school-details", schoolId],
    queryFn: () => getDetailsFn({ data: { id: schoolId! } }),
    enabled: isPlatformAdmin && !!schoolId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (params: { status: SchoolStatus; reason?: string }) =>
      updateStatusFn({ data: { id: schoolId!, status: params.status, reason: params.reason || "" } }),
    onSuccess: () => {
      toast.success("School status updated");
      void qc.invalidateQueries({ queryKey: ["school-details", schoolId] });
      void qc.invalidateQueries({ queryKey: ["platform"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isPlatformAdmin) {
    return (
      <DashboardShell greeting="Platform" dateLine="System Administrators only">
        <div className={card}>
          <h2 className="font-display text-2xl font-bold text-ink">Restricted section</h2>
          <p className="mt-2 text-sm text-soft">Only System Administrators can view school details.</p>
        </div>
      </DashboardShell>
    );
  }

  if (isLoading) {
    return (
      <DashboardShell greeting="Loading..." dateLine="Please wait">
        <div className={card}>
          <p className="text-sm text-soft">Loading school details...</p>
        </div>
      </DashboardShell>
    );
  }

  if (!school) {
    return (
      <DashboardShell greeting="Not found" dateLine="School not found">
        <div className={card}>
          <p className="text-sm text-soft">School not found.</p>
          <Link to="/platform" className="mt-4 inline-block text-sm text-brand underline">
            Back to platform
          </Link>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell greeting={school.name} dateLine="School details">
      <div className="mb-4">
        <Link to="/platform" className="text-sm text-brand underline">
          ← Back to platform
        </Link>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="subscription">Subscription & Payments</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab school={school} onUpdateStatus={updateStatusMutation.mutate} />
        </TabsContent>
        <TabsContent value="staff">
          <StaffTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="subscription">
          <SubscriptionTab schoolId={schoolId} school={school} />
        </TabsContent>
        <TabsContent value="support">
          <SupportTab schoolId={schoolId} />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function OverviewTab({
  school,
  onUpdateStatus,
}: {
  school: any;
  onUpdateStatus: (params: { status: SchoolStatus; reason?: string }) => void;
}) {
  const [statusReason, setStatusReason] = useState("");

  const formatDateTime = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString();
    } catch {
      return "—";
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return "—";
    }
  };

  return (
    <div className="space-y-6">
      <div className={card}>
        <h3 className="font-display text-lg font-bold text-ink">School Information</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Status</p>
            <p className={`mt-1 text-sm font-medium ${school.status === "active" ? "text-ok" : "text-danger"}`}>
              {school.status}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Plan</p>
            <p className="mt-1 text-sm text-ink">{school.plan}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Trial ends</p>
            <p className="mt-1 text-sm text-ink">{formatDate(school.trial_ends_at)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Student limit</p>
            <p className="mt-1 text-sm text-ink">
              {school.student_count} / {school.student_limit ?? "unlimited"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Staff count</p>
            <p className="mt-1 text-sm text-ink">{school.staff_count}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Last activity</p>
            <p className="mt-1 text-sm text-ink">{formatDateTime(school.last_activity)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Entries this term</p>
            <p className="mt-1 text-sm text-ink">{school.entries_this_term ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Status change */}
      <div className={card}>
        <h3 className="font-display text-lg font-bold text-ink">Change Status</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-soft">
            Reason (optional)
            <input
              type="text"
              className={`${field} mt-1 w-full`}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="E.g., Payment received, Trial period ended, etc."
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                onUpdateStatus({ status: "active", reason: statusReason });
                setStatusReason("");
              }}
              className="rounded-2xl bg-ok px-4 py-2 text-sm font-semibold text-white"
            >
              Set Active
            </button>
            <button
              onClick={() => {
                if (confirm("Are you sure you want to change to trial status?")) {
                  toast.info("Trial status not yet supported in the current status types");
                }
              }}
              className="rounded-2xl bg-warn px-4 py-2 text-sm font-semibold text-white"
            >
              Set Trial (coming soon)
            </button>
            <button
              onClick={() => {
                onUpdateStatus({ status: "suspended", reason: statusReason || "No reason provided" });
                setStatusReason("");
              }}
              className="rounded-2xl bg-danger px-4 py-2 text-sm font-semibold text-white"
            >
              Suspend
            </button>
            <button
              onClick={() => {
                if (confirm("Are you sure you want to cancel this school? This action is reversible but will lock the school.")) {
                  onUpdateStatus({ status: "cancelled", reason: statusReason || "No reason provided" });
                  setStatusReason("");
                }
              }}
              className="rounded-2xl bg-danger/80 px-4 py-2 text-sm font-semibold text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Open school view button */}
      <div className={card}>
        <h3 className="font-display text-lg font-bold text-ink">Support View</h3>
        <p className="mt-2 text-sm text-soft">
          Open this school's workspace to troubleshoot or provide support. Every page shows only this school's data,
          and anything you record is saved to this school and marked as done by the platform owner.
        </p>
        <OpenSchoolViewButton schoolId={school.id} />
      </div>
    </div>
  );
}

/** Opens the school's dashboard in support view (banner: "Viewing <school> as platform owner"). */
function OpenSchoolViewButton({ schoolId }: { schoolId: string }) {
  const { enterSupportView } = useAuth();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  return (
    <button
      className={`${btn} mt-4`}
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        try {
          await enterSupportView(schoolId);
          await navigate({ to: "/" });
        } catch (e) {
          toast.error((e as Error).message);
          setOpening(false);
        }
      }}
    >
      {opening ? "Opening…" : "Open school view"}
    </button>
  );
}

function StaffTab({ schoolId }: { schoolId: string }) {
  // TODO: Implement staff management for this specific school
  return (
    <div className={card}>
      <h3 className="font-display text-lg font-bold text-ink">Staff Management</h3>
      <p className="mt-4 text-sm text-soft">Staff management for this school will be implemented here.</p>
    </div>
  );
}

function SubscriptionTab({ schoolId, school }: { schoolId: string; school: any }) {
  const qc = useQueryClient();
  const recordPaymentFn = useServerFn(recordSchoolPayment);
  const getPaymentsFn = useServerFn(getSchoolPayments);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payment, setPayment] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: "",
    method: "MTN MoMo",
    reference: "",
    period: "",
    note: "",
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["school-payments", schoolId],
    queryFn: () => getPaymentsFn({ data: { school_id: schoolId } }),
  });

  const recordMutation = useMutation({
    mutationFn: (paymentData: any) => recordPaymentFn({ data: paymentData }),
    onSuccess: () => {
      toast.success("Payment recorded");
      setShowPaymentForm(false);
      setPayment({
        date: new Date().toISOString().split("T")[0],
        amount: "",
        method: "MTN MoMo",
        reference: "",
        period: "",
        note: "",
      });
      void qc.invalidateQueries({ queryKey: ["school-payments", schoolId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAddPayment = () => {
    if (!payment.amount || parseFloat(payment.amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    recordMutation.mutate({
      school_id: schoolId,
      payment_date: payment.date,
      amount: parseFloat(payment.amount),
      method: payment.method,
      reference: payment.reference || undefined,
      period_covered: payment.period || undefined,
      note: payment.note || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className={card}>
        <h3 className="font-display text-lg font-bold text-ink">Subscription Details</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Current Plan</p>
            <p className="mt-1 text-sm text-ink">{school.plan}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-faint">Status</p>
            <p className={`mt-1 text-sm font-medium ${school.status === "active" ? "text-ok" : "text-danger"}`}>
              {school.status}
            </p>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-ink">Payments Log</h3>
          <button
            onClick={() => setShowPaymentForm(!showPaymentForm)}
            className={btn}
          >
            {showPaymentForm ? "Cancel" : "Record Payment"}
          </button>
        </div>

        {showPaymentForm && (
          <div className="mt-4 space-y-3 rounded-2xl bg-glass-bright p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-soft">
                Date
                <input
                  type="date"
                  className={`${field} mt-1 w-full`}
                  value={payment.date}
                  onChange={(e) => setPayment({ ...payment, date: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-soft">
                Amount (RWF)
                <input
                  type="number"
                  className={`${field} mt-1 w-full`}
                  value={payment.amount}
                  onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-soft">
                Method
                <select
                  className={`${field} mt-1 w-full`}
                  value={payment.method}
                  onChange={(e) => setPayment({ ...payment, method: e.target.value })}
                >
                  <option value="MTN MoMo">MTN MoMo</option>
                  <option value="Airtel Money">Airtel Money</option>
                  <option value="Bank">Bank</option>
                  <option value="Cash">Cash</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-soft">
                Reference
                <input
                  type="text"
                  className={`${field} mt-1 w-full`}
                  value={payment.reference}
                  onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
                  placeholder="Transaction ID or receipt number"
                />
              </label>
            </div>
            <label className="block text-xs font-semibold text-soft">
              Period covered
              <input
                type="text"
                className={`${field} mt-1 w-full`}
                value={payment.period}
                onChange={(e) => setPayment({ ...payment, period: e.target.value })}
                placeholder="E.g., Term 1 2026, Q1 2026, etc."
              />
            </label>
            <label className="block text-xs font-semibold text-soft">
              Note (optional)
              <textarea
                className={`${field} mt-1 w-full`}
                rows={2}
                value={payment.note}
                onChange={(e) => setPayment({ ...payment, note: e.target.value })}
                placeholder="Additional notes"
              />
            </label>
            <button onClick={handleAddPayment} className={btn}>
              Save Payment
            </button>
          </div>
        )}

        <div className="mt-4">
          {payments.length === 0 ? (
            <p className="text-sm text-soft">No payments recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p: any) => (
                <div key={p.id} className="rounded-2xl bg-glass-bright p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-ink">
                        {new Intl.NumberFormat("en-RW", {
                          style: "currency",
                          currency: "RWF",
                          minimumFractionDigits: 0,
                        }).format(p.amount)}
                      </p>
                      <p className="text-xs text-soft">
                        {p.method} • {p.reference} • {new Date(p.date).toLocaleDateString()}
                      </p>
                      {p.period && <p className="text-xs text-faint">Period: {p.period}</p>}
                      {p.note && <p className="text-xs text-faint">{p.note}</p>}
                    </div>
                    <button className="text-xs text-brand underline">Print receipt</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SupportTab({ schoolId }: { schoolId: string }) {
  const qc = useQueryClient();
  const createNoteFn = useServerFn(createSupportNote);
  const getNotesFn = useServerFn(getSchoolSupportNotes);
  const updateNoteFn = useServerFn(updateSupportNoteStatus);

  const [showNoteForm, setShowNoteForm] = useState(false);
  const [note, setNote] = useState({
    subject: "",
    status: "open" as "open" | "resolved",
    note: "",
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["school-support-notes", schoolId],
    queryFn: () => getNotesFn({ data: { school_id: schoolId } }),
  });

  const createMutation = useMutation({
    mutationFn: (noteData: any) => createNoteFn({ data: noteData }),
    onSuccess: () => {
      toast.success("Support note added");
      setShowNoteForm(false);
      setNote({ subject: "", status: "open", note: "" });
      void qc.invalidateQueries({ queryKey: ["school-support-notes", schoolId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; status: "open" | "resolved" }) => updateNoteFn({ data: params }),
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["school-support-notes", schoolId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAddNote = () => {
    if (!note.subject.trim() || !note.note.trim()) {
      toast.error("Subject and note are required");
      return;
    }

    createMutation.mutate({
      school_id: schoolId,
      subject: note.subject,
      status: note.status,
      note: note.note,
    });
  };

  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-ink">Support Notes</h3>
        <button
          onClick={() => setShowNoteForm(!showNoteForm)}
          className={btn}
        >
          {showNoteForm ? "Cancel" : "Add Note"}
        </button>
      </div>

      {showNoteForm && (
        <div className="mt-4 space-y-3 rounded-2xl bg-glass-bright p-4">
          <label className="block text-xs font-semibold text-soft">
            Subject
            <input
              type="text"
              className={`${field} mt-1 w-full`}
              value={note.subject}
              onChange={(e) => setNote({ ...note, subject: e.target.value })}
              placeholder="E.g., Login issue, Payment question, etc."
            />
          </label>
          <label className="block text-xs font-semibold text-soft">
            Status
            <select
              className={`${field} mt-1 w-full`}
              value={note.status}
              onChange={(e) => setNote({ ...note, status: e.target.value as "open" | "resolved" })}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-soft">
            Note
            <textarea
              className={`${field} mt-1 w-full`}
              rows={4}
              value={note.note}
              onChange={(e) => setNote({ ...note, note: e.target.value })}
              placeholder="Describe the issue or request..."
            />
          </label>
          <button onClick={handleAddNote} className={btn}>
            Save Note
          </button>
        </div>
      )}

      <div className="mt-4">
        {notes.length === 0 ? (
          <p className="text-sm text-soft">No support notes yet.</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n: any) => (
              <div key={n.id} className="rounded-2xl bg-glass-bright p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-semibold text-ink">{n.subject}</p>
                    <p className="text-xs text-soft">
                      {new Date(n.created_at).toLocaleDateString()} •{" "}
                      <span className={n.status === "open" ? "text-warn" : "text-ok"}>{n.status}</span>
                    </p>
                    <p className="mt-1 text-sm text-body">{n.note}</p>
                  </div>
                  <button
                    onClick={() =>
                      updateMutation.mutate({
                        id: n.id,
                        status: n.status === "open" ? "resolved" : "open",
                      })
                    }
                    className="ml-2 text-xs text-brand underline"
                    disabled={updateMutation.isPending}
                  >
                    Mark {n.status === "open" ? "resolved" : "open"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
