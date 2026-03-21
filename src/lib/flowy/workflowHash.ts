import { createHash } from "crypto";

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((x) => stableStringify(x)).join(",")}]`;
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

export function computeWorkflowHash(state: {
  nodes: unknown[];
  edges: unknown[];
  groups?: Record<string, unknown>;
}): string {
  const raw = stableStringify({
    nodes: state.nodes ?? [],
    edges: state.edges ?? [],
    groups: state.groups ?? {},
  });
  return createHash("sha256").update(raw).digest("hex");
}

