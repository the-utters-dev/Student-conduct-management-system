import { describe, expect, it } from "vitest";
import { standingOf } from "@/hooks/useConductStandings";
describe("conduct standing thresholds", () => {
  it("20 or below is critical", () => expect(standingOf(20, 20, 30)).toBe("critical"));
  it("21 to 30 is warning", () => { expect(standingOf(21, 20, 30)).toBe("warning"); expect(standingOf(30, 20, 30)).toBe("warning"); });
  it("above 30 is good", () => expect(standingOf(31, 20, 30)).toBe("good"));
});
