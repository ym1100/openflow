import { describe, expect, it } from "vitest";
import { capFlowyChatHistory } from "./capFlowyChatHistory";

describe("capFlowyChatHistory", () => {
  it("returns last turns within maxTurns", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `m${i}`,
    }));
    const out = capFlowyChatHistory(msgs, 4, 100_000);
    expect(out).toHaveLength(4);
    expect(out[0].text).toBe("m16");
  });

  it("respects maxChars", () => {
    const msgs = [
      { role: "user" as const, text: "a".repeat(100) },
      { role: "assistant" as const, text: "b".repeat(100) },
      { role: "user" as const, text: "c".repeat(100) },
    ];
    const out = capFlowyChatHistory(msgs, 14, 150);
    expect(out.length).toBeLessThan(3);
  });
});
