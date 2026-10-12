import { describe, expect, it } from "vitest";
import { buildParentMessage, smsSegments, whatsappLink } from "./messaging";

const base = {
  studentName: "Aline Uwase",
  entryType: "deduction" as const,
  marks: 5,
  reason: "Late to class",
  balance: 35,
  startingMarks: 40,
  occurredOn: "2026-10-12",
  evidenceUrl: null,
  schoolName: "Northfield Academy",
};

describe("parent messages", () => {
  it("uses the agreed SMS wording with balance out of 40", () => {
    expect(buildParentMessage("sms", base)).toBe(
      "SCDMS Update: Aline Uwase received a Deduction of 5 marks for 'Late to class'. Current Conduct Balance: 35/40.",
    );
  });
  it("appends a web evidence link but never an inline image", () => {
    expect(buildParentMessage("sms", { ...base, evidenceUrl: "https://x.test/a.jpg" })).toContain(
      "Evidence: https://x.test/a.jpg",
    );
    expect(buildParentMessage("sms", { ...base, evidenceUrl: "data:image/jpeg;base64,AAA" })).not.toContain(
      "Evidence",
    );
  });
  it("normalises Rwandan numbers for WhatsApp", () => {
    expect(whatsappLink("0788 123 456", "hi")).toBe("https://wa.me/250788123456?text=hi");
    expect(whatsappLink("+250 788 123 456", "hi")).toBe("https://wa.me/250788123456?text=hi");
  });
  it("counts SMS segments", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
  });
});
