import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { db, insertWithColumnFallback } from "@/lib/evidence";
import {
  buildParentMessage,
  smsSegments,
  whatsappLink,
  type MessageChannel,
  type MessageContext,
} from "@/lib/messaging";

export interface ComposerEntry {
  conductLogId: string;
  studentId: string;
  phone: string | null;
  context: MessageContext;
}

export function ParentMessageComposer({
  entry,
  onOpenChange,
  open,
  prefilledStudentIds,
  templateType,
}: {
  entry?: ComposerEntry | null;
  onOpenChange: (open: boolean) => void;
  open?: boolean;
  prefilledStudentIds?: string[];
  templateType?: "student_of_week";
}) {
  const { user, isDisciplineStaff, school, schoolId } = useAuth();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<MessageChannel>("sms");
  const [text, setText] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (templateType === "student_of_week") {
      // Student of the Week template
      const schoolName = school?.name ?? "Your School";
      if (channel === "sms") {
        setText(
          `Congratulations from ${schoolName}! Your child has been named Student of the Week for outstanding good conduct and positive behaviour. Well done!`
        );
      } else {
        setText(
          [
            `*${schoolName} — Congratulations!*`,
            ``,
            `Dear parent/guardian,`,
            ``,
            `We are delighted to inform you that your child has been recognised as *Student of the Week* for their exceptional good conduct and positive behaviour.`,
            ``,
            `This recognition is awarded to students who have demonstrated outstanding character, responsibility, and respect throughout the week with no conduct deductions.`,
            ``,
            `Thank you for your continued partnership in raising such a wonderful student. We celebrate this achievement with you!`,
          ].join("\n")
        );
      }
      return;
    }
    if (!entry) return;
    setPhone(entry.phone ?? "");
    // Use tenant school name, or fallback to entry.context.schoolName
    const contextWithSchool = { ...entry.context, schoolName: school?.name ?? entry.context.schoolName };
    setText(buildParentMessage(channel, contextWithSchool));
  }, [entry, channel, school, templateType]);

  const save = useMutation({
    mutationFn: async (status: "draft" | "pending") => {
      if (templateType === "student_of_week") {
        // For student of week, just open WhatsApp or show success
        toast.success("Template ready. Edit and send via WhatsApp.");
        return { status, dropped: [] };
      }
      if (!entry) throw new Error("No entry selected.");
      if (!text.trim()) throw new Error("The message is empty.");
      if (status === "pending" && !phone.trim()) throw new Error("Add a parent phone number first.");
      const { data, dropped } = await insertWithColumnFallback(
        "notification_logs",
        {
          conduct_log_id: entry.conductLogId,
          student_id: entry.studentId,
          recipient_phone: phone.trim() || null,
          message_body: text.trim(),
          status,
          channel,
        },
        ["channel"],
      );
      await db.from("audit_logs").insert({
        user_id: user?.id ?? null,
        action: status === "draft" ? "DRAFT_PARENT_MESSAGE" : "QUEUE_PARENT_MESSAGE",
        entity_type: "notification_logs",
        entity_id: data.id,
        payload: { conduct_log_id: entry.conductLogId, channel, length: text.length },
      });
      return { status, dropped };
    },
    onSuccess: ({ status, dropped }) => {
      toast.success(status === "draft" ? "Draft saved" : `${channel === "sms" ? "SMS" : "WhatsApp message"} queued`, {
        description: dropped.length ? "Channel not stored — run the multi-tenant database script." : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["notification-logs", schoolId] });
      void queryClient.invalidateQueries({ queryKey: ["audit-logs", schoolId] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(
        /status_check|row-level/i.test(e.message)
          ? "The database doesn't allow this yet — run the multi-tenant database script."
          : e.message,
      ),
  });

  const field =
    "w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-body outline-none ring-1 ring-hairline focus:ring-2 focus:ring-brand/50";

  return (
    <Dialog open={open ?? !!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {templateType === "student_of_week" ? "Send congratulations" : "Message parent"}
          </DialogTitle>
          <DialogDescription>
            {templateType === "student_of_week"
              ? "Edit the template message below and send to the parents of selected students."
              : `${entry?.context.studentName} · edit the message, then save a draft or send it.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-glass-bright p-1 ring-1 ring-hairline">
          {(["sms", "whatsapp"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={
                channel === c
                  ? "rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand"
                  : "rounded-xl px-4 py-2 text-[13px] font-semibold text-soft hover:text-ink"
              }
            >
              {c === "sms" ? "SMS (MTN/Airtel)" : "WhatsApp"}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {templateType !== "student_of_week" && (
              <>
                <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  Parent phone
                </label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+250 7XX XXX XXX" className={field} />
              </>
            )}
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Message</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={templateType === "student_of_week" ? 12 : 9} className={`${field} resize-y`} />
            <p className="text-[11px] text-soft">
              {text.length} characters
              {channel === "sms" ? ` · ${smsSegments(text)} SMS segment${smsSegments(text) === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Preview</p>
            <div className="rounded-3xl bg-glass-soft p-4 ring-1 ring-hairline">
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-glass-bright px-4 py-3 text-[13px] text-ink shadow-panel">
                {text || "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {templateType === "student_of_week" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(text);
                  toast.success("Message copied to clipboard");
                }}
                className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-soft ring-1 ring-hairline hover:text-ink"
              >
                Copy message
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate("draft")}
                className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-soft ring-1 ring-hairline hover:text-ink disabled:opacity-50"
              >
                Save draft
              </button>
              {channel === "whatsapp" ? (
                <a
                  href={phone ? whatsappLink(phone, text) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => phone && isDisciplineStaff && save.mutate("pending")}
                  className={`rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand ${phone ? "" : "pointer-events-none opacity-50"}`}
                >
                  Open in WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  disabled={save.isPending || !isDisciplineStaff}
                  onClick={() => save.mutate("pending")}
                  className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50"
                >
                  Queue SMS
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
