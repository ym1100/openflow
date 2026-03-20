export type FlowyChatHistoryTurn = { role: "user" | "assistant"; text: string };

/**
 * Cap planner chat history for token control (mirrors Python FLOWY_CHAT_* env defaults).
 */
export function capFlowyChatHistory(
  messages: FlowyChatHistoryTurn[],
  maxTurns = 14,
  maxChars = 4000
): FlowyChatHistoryTurn[] {
  if (!messages.length || maxTurns <= 0) return [];
  const slice = messages.slice(-maxTurns);
  const kept: FlowyChatHistoryTurn[] = [];
  let total = 0;
  for (let i = slice.length - 1; i >= 0; i--) {
    const t = slice[i];
    const len = t.text.length + 24;
    if (total + len > maxChars && kept.length > 0) break;
    kept.push(t);
    total += len;
  }
  kept.reverse();
  return kept;
}
