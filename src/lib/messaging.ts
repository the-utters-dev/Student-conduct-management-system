export type MessageChannel = "sms" | "whatsapp";

export interface MessageContext {
  studentName: string;
  entryType: "deduction" | "restoration";
  marks: number;
  reason: string | null;
  balance: number | null;
  startingMarks: number;
  occurredOn: string;
  evidenceUrl: string | null;
  schoolName: string;
}

const isHttp = (u: string | null) => !!u && /^https?:\/\//.test(u);

export function buildParentMessage(channel: MessageChannel, c: MessageContext): string {
  const label = c.entryType === "deduction" ? "Deduction" : "Restoration";
  const cause = c.reason?.trim() || "conduct review";
  const balance = c.balance ?? c.startingMarks;
  const evidence = isHttp(c.evidenceUrl) ? c.evidenceUrl : null;
  if (channel === "sms") {
    return (
      `SCDMS Update: ${c.studentName} received a ${label} of ${c.marks} marks for '${cause}'. ` +
      `Current Conduct Balance: ${balance}/${c.startingMarks}.` +
      (evidence ? ` Evidence: ${evidence}` : "")
    );
  }
  return [
    `*${c.schoolName} — Conduct notice*`,
    ``,
    `Dear parent/guardian of *${c.studentName}*,`,
    `On ${c.occurredOn}, a *${label.toLowerCase()} of ${c.marks} marks* was recorded for: _${cause}_.`,
    `Current conduct balance: *${balance}/${c.startingMarks}*.`,
    ...(evidence ? [``, `Evidence: ${evidence}`] : []),
    ``,
    `Please contact the school's discipline office if you have any questions.`,
  ].join("\n");
}

/** Number of 160-character SMS segments a message will use. */
export function smsSegments(text: string): number {
  if (!text.length) return 0;
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/** wa.me link: digits only, Rwandan numbers normalised to 250XXXXXXXXX. */
export function whatsappLink(phone: string, text: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "250" + digits.slice(1);
  if (digits.length === 9) digits = "250" + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
