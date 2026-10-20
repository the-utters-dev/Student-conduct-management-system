export type MessageChannel = "sms" | "whatsapp";

export interface MessageContext {
  studentName: string;
  entryType: "deduction" | "restoration" | "good_deed";
  marks: number;
  reason: string | null;
  balance: number | null;
  startingMarks: number;
  occurredOn: string;
  evidenceUrl: string | null;
  schoolName: string;
  goodDeedCategory?: string | null;
}

const isHttp = (u: string | null) => !!u && /^https?:\/\//.test(u);

export function buildParentMessage(channel: MessageChannel, c: MessageContext): string {
  const balance = c.balance ?? c.startingMarks;
  const evidence = isHttp(c.evidenceUrl) ? c.evidenceUrl : null;

  // Good deed messages
  if (c.entryType === "good_deed") {
    const category = c.goodDeedCategory?.trim() || c.reason?.trim() || "good conduct";
    if (channel === "sms") {
      // SMS: under 160 characters where possible
      const base = `Good news from ${c.schoolName}! ${c.studentName} was recognised for ${category}.`;
      if (c.marks > 0) {
        // Include balance if marks were given and it fits
        const withBalance = `${base} Conduct: ${balance}/${c.startingMarks}. Thank you for raising a responsible child.`;
        if (withBalance.length <= 160) return withBalance;
        return base + " Thank you for raising a responsible child.";
      }
      return base + " Thank you for raising a responsible child.";
    }
    // WhatsApp: longer, friendly version
    return [
      `*${c.schoolName} — Good news*`,
      ``,
      `Dear parent/guardian of *${c.studentName}*,`,
      ``,
      `We are pleased to inform you that on ${c.occurredOn}, your child was recognised for: _${category}_.`,
      ...(c.marks > 0
        ? [`This positive action has been rewarded with *${c.marks} marks* added back to their conduct balance.`]
        : [`This recognition has been recorded in their conduct file.`]),
      ...(c.marks > 0 ? [`Current conduct balance: *${balance}/${c.startingMarks}*.`] : []),
      ...(evidence ? [``, `Evidence: ${evidence}`] : []),
      ``,
      `Thank you for raising a responsible and respectful child. We appreciate your partnership in their development.`,
    ].join("\n");
  }

  // Deduction and restoration messages
  const label = c.entryType === "deduction" ? "Deduction" : "Restoration";
  const cause = c.reason?.trim() || "conduct review";
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
