/**
 * Openflow-only agent commands (inspired by agent-browser’s snapshot + ref workflow,
 * but scoped to this app — no arbitrary URLs or foreign sites).
 *
 * Workflow: snapshot → model picks refs → click / fill / type / wait → snapshot again.
 *
 * @see https://agent-browser.dev/ (reference UX, not a runtime dependency)
 */

import type { NodeType } from "@/types";

/** Must match planner / workflow node types for agentNodeType targets. */
const ALLOWED_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  "mediaInput",
  "imageInput",
  "audioInput",
  "annotation",
  "comment",
  "prompt",
  "generateImage",
  "generateVideo",
  "generateAudio",
  "imageCompare",
  "easeCurve",
  "router",
  "switch",
  "conditionalSwitch",
  "generate3d",
  "glbViewer",
]);

// ---------------------------------------------------------------------------
// Registry: stable refs → how to find the element in our DOM
// ---------------------------------------------------------------------------

export type OpenflowRegistryEntry = {
  /** Stable id for snapshots, e.g. "ui.addNode" */
  ref: string;
  /** Short label for the accessibility-style snapshot line */
  label: string;
  /** Preferred resolution: data-id on our components */
  dataId?: string;
  /** Optional CSS selector (must stay within Openflow UI; avoid arbitrary document queries from LLM) */
  selector?: string;
};

/**
 * Static chrome we control. Extend this as you add `data-id` / `data-openflow-ref` hooks.
 */
export const OPENFLOW_UI_REGISTRY: OpenflowRegistryEntry[] = [
  { ref: "ui.addNode", label: "Add node (+)", dataId: "add-node-button" },
  { ref: "ui.addComment", label: "Add comment", dataId: "add-comment-button" },
  { ref: "ui.runBar", label: "Run action bar", dataId: "run-action-bar" },
  { ref: "ui.projectSideToolbar", label: "Project side toolbar", dataId: "project-side-toolbar" },
  { ref: "ui.mediaPopover", label: "Media popover button", dataId: "media-popover-button" },
  { ref: "ui.annotationToolbar", label: "Annotation floating toolbar", dataId: "annotation-floating-toolbar" },
];

// ---------------------------------------------------------------------------
// Targets (what the executor resolves)
// ---------------------------------------------------------------------------

export type OpenflowAgentTarget =
  | { kind: "ref"; ref: string }
  | { kind: "dataId"; value: string }
  | { kind: "agentNodeType"; nodeType: NodeType }
  | { kind: "flowNode"; nodeId: string }
  | { kind: "handle"; nodeId: string; handleId?: string };

export type OpenflowAgentCommand =
  | { type: "snapshot" }
  | { type: "click"; target: OpenflowAgentTarget }
  | { type: "dblclick"; target: OpenflowAgentTarget }
  | { type: "hover"; target: OpenflowAgentTarget }
  | { type: "scrollIntoView"; target: OpenflowAgentTarget }
  | { type: "fill"; target: OpenflowAgentTarget; text: string }
  | { type: "type"; target: OpenflowAgentTarget; text: string; charDelayMs?: number }
  | { type: "press"; key: string }
  | { type: "wait"; ms: number }
  | { type: "waitFor"; target: OpenflowAgentTarget; timeoutMs?: number };

export type OpenflowAgentSnapshotRefMeta = {
  ref: string;
  label: string;
  present: boolean;
  selector: string;
};

export type OpenflowAgentSnapshotResult = {
  /** Plain text for LLM context (agent-browser-style lines) */
  text: string;
  refs: Record<string, OpenflowAgentSnapshotRefMeta>;
};

type SleepFn = (ms: number) => Promise<void>;

export type OpenflowAgentExecutorDeps = {
  sleep: SleepFn;
  /** Optional: virtual cursor (Flowy panel). If omitted, actions still dispatch real DOM events. */
  setCursor?: (partial: { actionLabel?: string; x?: number; y?: number }) => void;
  getCursorPos?: () => { x: number; y: number };
  /** Used after typing into prompt nodes when textarea path fails */
  storeUpdateNodeData?: (nodeId: string, data: Record<string, unknown>) => void;
};

// ---------------------------------------------------------------------------
// Resolve target → HTMLElement
// ---------------------------------------------------------------------------

function queryByDataId(dataId: string): HTMLElement | null {
  return document.querySelector(`[data-id="${CSS.escape(dataId)}"]`) as HTMLElement | null;
}

function resolveRegistryRef(ref: string): HTMLElement | null {
  const entry = OPENFLOW_UI_REGISTRY.find((e) => e.ref === ref);
  if (!entry) return null;
  if (entry.dataId) {
    const el = queryByDataId(entry.dataId);
    if (el) return el;
  }
  if (entry.selector) {
    return document.querySelector(entry.selector) as HTMLElement | null;
  }
  return null;
}

export function resolveOpenflowTarget(target: OpenflowAgentTarget): HTMLElement | null {
  switch (target.kind) {
    case "ref":
      return resolveRegistryRef(target.ref);
    case "dataId":
      return queryByDataId(target.value);
    case "agentNodeType": {
      const sel = `[data-agent-node-type="${CSS.escape(target.nodeType)}"]`;
      return document.querySelector(sel) as HTMLElement | null;
    }
    case "flowNode": {
      const sel = `.react-flow__node[data-id="${CSS.escape(target.nodeId)}"]`;
      return document.querySelector(sel) as HTMLElement | null;
    }
    case "handle": {
      const node = document.querySelector(
        `.react-flow__node[data-id="${CSS.escape(target.nodeId)}"]`
      );
      if (!node) return null;
      const h = target.handleId
        ? node.querySelector(
            `.react-flow__handle[data-handleid="${CSS.escape(target.handleId)}"]`
          )
        : node.querySelector(".react-flow__handle");
      return h as HTMLElement | null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function elementLine(role: string, label: string, ref: string, present: boolean): string {
  const state = present ? "" : " [missing]";
  return `- ${role} "${label}" [ref=${ref}]${state}`;
}

/**
 * Build a compact, agent-browser-like text snapshot of Openflow’s UI + graph.
 * Safe to call from client only.
 */
export function buildOpenflowAgentSnapshot(): OpenflowAgentSnapshotResult {
  if (typeof document === "undefined") {
    return {
      text: "# Openflow UI snapshot\n(no document — SSR or worker)\n",
      refs: {},
    };
  }

  const refs: Record<string, OpenflowAgentSnapshotRefMeta> = {};
  const lines: string[] = ["# Openflow UI snapshot", "(scoped to this app only — use refs below with OpenflowAgentCommand)", ""];

  lines.push("## Chrome / toolbars");
  for (const entry of OPENFLOW_UI_REGISTRY) {
    const el = entry.dataId ? queryByDataId(entry.dataId) : null;
    const present = Boolean(el);
    const selector = entry.dataId ? `[data-id="${entry.dataId}"]` : (entry.selector ?? "");
    refs[entry.ref] = {
      ref: entry.ref,
      label: entry.label,
      present,
      selector,
    };
    lines.push(elementLine("control", entry.label, entry.ref, present));
  }

  lines.push("");
  lines.push("## Add-node menu entries (visible when + menu is open)");
  const menuButtons = document.querySelectorAll<HTMLElement>("[data-agent-node-type]");
  menuButtons.forEach((btn) => {
    const nt = btn.getAttribute("data-agent-node-type") || "";
    if (!nt) return;
    const ref = `menu.node.${nt}`;
    const label = btn.innerText?.split("\n")[0]?.trim() || nt;
    const visible = btn.getClientRects().length > 0;
    refs[ref] = { ref, label, present: visible, selector: `[data-agent-node-type="${nt}"]` };
    lines.push(elementLine("menuItem", label, ref, visible));
  });

  lines.push("");
  lines.push("## Canvas nodes (React Flow)");
  const nodes = document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]");
  nodes.forEach((node) => {
    const id = node.getAttribute("data-id") || "";
    if (!id) return;
    const ref = `node.${id}`;
    const type = node.getAttribute("data-type") || node.className || "node";
    refs[ref] = {
      ref,
      label: `${type} (${id})`,
      present: true,
      selector: `.react-flow__node[data-id="${id}"]`,
    };
    lines.push(`- node ${type} id=${id} [ref=${ref}]`);
  });

  lines.push("");
  lines.push("## Commands");
  lines.push(
    "Use only OpenflowAgentCommand JSON in this app. Targets: ref | dataId | agentNodeType | flowNode | handle."
  );

  return {
    text: lines.join("\n"),
    refs,
  };
}

// ---------------------------------------------------------------------------
// Low-level DOM actions
// ---------------------------------------------------------------------------

function centerOf(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function dispatchClick(el: HTMLElement, detail = 1) {
  const { x, y } = centerOf(el);
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window,
      detail,
    })
  );
}

function dispatchDblClick(el: HTMLElement) {
  dispatchClick(el, 1);
  dispatchClick(el, 2);
}

async function simulateTyping(
  textarea: HTMLTextAreaElement,
  text: string,
  charDelay: number,
  sleep: SleepFn
) {
  textarea.focus();
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  for (let i = 0; i < text.length; i++) {
    const partial = text.slice(0, i + 1);
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, partial);
    } else {
      textarea.value = partial;
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(charDelay);
  }
}

function findTextareaInFlowNode(nodeId: string): HTMLTextAreaElement | null {
  const nodeEl = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (!nodeEl) return null;
  return nodeEl.querySelector("textarea") as HTMLTextAreaElement | null;
}

// ---------------------------------------------------------------------------
// Execute one command
// ---------------------------------------------------------------------------

export type OpenflowCommandResult =
  | { ok: true; detail?: string }
  | { ok: false; error: string };

export async function executeOpenflowAgentCommand(
  cmd: OpenflowAgentCommand,
  deps: OpenflowAgentExecutorDeps
): Promise<OpenflowCommandResult> {
  const { sleep, setCursor, getCursorPos } = deps;

  const pulse = (label: string, el: HTMLElement | null) => {
    setCursor?.({ actionLabel: label });
    if (el) {
      const c = centerOf(el);
      setCursor?.({ x: c.x, y: c.y });
    }
  };

  try {
    switch (cmd.type) {
      case "snapshot":
        return { ok: true, detail: "use buildOpenflowAgentSnapshot() from caller" };

      case "wait":
        await sleep(Math.max(0, Math.min(cmd.ms, 60_000)));
        return { ok: true };

      case "press": {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: cmd.key, bubbles: true, cancelable: true })
        );
        return { ok: true };
      }

      case "waitFor": {
        const timeout = cmd.timeoutMs ?? 8000;
        const step = 80;
        let waited = 0;
        while (waited < timeout) {
          if (resolveOpenflowTarget(cmd.target)) return { ok: true };
          await sleep(step);
          waited += step;
        }
        return { ok: false, error: "waitFor: target not found within timeout" };
      }

      case "click":
      case "dblclick":
      case "hover":
      case "scrollIntoView": {
        const el = resolveOpenflowTarget(cmd.target);
        if (!el) return { ok: false, error: `${cmd.type}: target not found` };
        pulse(cmd.type, el);
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        await sleep(cmd.type === "scrollIntoView" ? 200 : 80);
        if (cmd.type === "hover") {
          const { x, y } = centerOf(el);
          el.dispatchEvent(
            new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y, view: window })
          );
          return { ok: true };
        }
        if (cmd.type === "dblclick") {
          dispatchDblClick(el);
        } else if (cmd.type === "click") {
          dispatchClick(el);
        }
        await sleep(120);
        return { ok: true };
      }

      case "fill":
      case "type": {
        const el = resolveOpenflowTarget(cmd.target);
        if (!el) return { ok: false, error: `${cmd.type}: target not found` };
        pulse(cmd.type, el);

        if (cmd.target.kind === "flowNode") {
          const ta = findTextareaInFlowNode(cmd.target.nodeId);
          if (ta) {
            const { x, y } = centerOf(ta);
            setCursor?.({ x, y });
            ta.focus();
            const delay =
              cmd.type === "type"
                ? Math.max(8, Math.min(30, cmd.charDelayMs ?? 12))
                : 0;
            if (cmd.type === "fill") {
              const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value"
              )?.set;
              if (setter) setter.call(ta, cmd.text);
              else ta.value = cmd.text;
              ta.dispatchEvent(new Event("input", { bubbles: true }));
              ta.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              await simulateTyping(ta, cmd.text, delay, sleep);
            }
            await sleep(80);
            return { ok: true };
          }
          deps.storeUpdateNodeData?.(cmd.target.nodeId, {
            prompt: cmd.text,
            _agentTouched: Date.now(),
          });
          await sleep(80);
          return { ok: true, detail: "textarea missing; used storeUpdateNodeData fallback" };
        }

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          if (cmd.type === "fill") {
            el.value = cmd.text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            if (el instanceof HTMLTextAreaElement) {
              await simulateTyping(
                el,
                cmd.text,
                Math.max(8, cmd.charDelayMs ?? 12),
                sleep
              );
            } else {
              el.value = cmd.text;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
          await sleep(80);
          return { ok: true };
        }

        return { ok: false, error: `${cmd.type}: target is not an input/textarea and not a flowNode` };
      }

      default:
        return { ok: false, error: "unknown command type" };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Run a batch sequentially; stops on first error if stopOnError (default true). */
export async function executeOpenflowAgentCommands(
  commands: OpenflowAgentCommand[],
  deps: OpenflowAgentExecutorDeps,
  options?: { stopOnError?: boolean }
): Promise<{ results: OpenflowCommandResult[]; stoppedAt?: number }> {
  const stopOnError = options?.stopOnError !== false;
  const results: OpenflowCommandResult[] = [];
  for (let i = 0; i < commands.length; i++) {
    const r = await executeOpenflowAgentCommand(commands[i], deps);
    results.push(r);
    if (!r.ok && stopOnError) {
      return { results, stoppedAt: i };
    }
  }
  return { results };
}

/** JSON-serializable list for planners / logs (no functions). */
export function openflowAgentCommandsSummary(commands: OpenflowAgentCommand[]): string {
  return JSON.stringify(commands, null, 0);
}

function parseTarget(raw: unknown): OpenflowAgentTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "ref" && typeof o.ref === "string") return { kind: "ref", ref: o.ref };
  if (kind === "dataId" && typeof o.value === "string") return { kind: "dataId", value: o.value };
  if (kind === "agentNodeType" && typeof o.nodeType === "string" && ALLOWED_NODE_TYPES.has(o.nodeType)) {
    return { kind: "agentNodeType", nodeType: o.nodeType as NodeType };
  }
  if (kind === "flowNode" && typeof o.nodeId === "string") return { kind: "flowNode", nodeId: o.nodeId };
  if (kind === "handle" && typeof o.nodeId === "string") {
    return {
      kind: "handle",
      nodeId: o.nodeId,
      handleId: typeof o.handleId === "string" ? o.handleId : undefined,
    };
  }
  return null;
}

/**
 * Parse `uiCommands` from planner JSON. Drops invalid entries.
 */
export function parseOpenflowUiCommandsFromJson(raw: unknown): OpenflowAgentCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenflowAgentCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type;
    if (type === "snapshot") {
      out.push({ type: "snapshot" });
      continue;
    }
    if (type === "wait" && typeof o.ms === "number" && Number.isFinite(o.ms)) {
      out.push({ type: "wait", ms: Math.max(0, Math.min(o.ms, 60_000)) });
      continue;
    }
    if (type === "press" && typeof o.key === "string") {
      out.push({ type: "press", key: o.key });
      continue;
    }
    const target = parseTarget(o.target);
    if (!target) continue;
    if (type === "click") {
      out.push({ type: "click", target });
      continue;
    }
    if (type === "dblclick") {
      out.push({ type: "dblclick", target });
      continue;
    }
    if (type === "hover") {
      out.push({ type: "hover", target });
      continue;
    }
    if (type === "scrollIntoView") {
      out.push({ type: "scrollIntoView", target });
      continue;
    }
    if (type === "waitFor") {
      out.push({
        type: "waitFor",
        target,
        timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs : undefined,
      });
      continue;
    }
    if (type === "fill" && typeof o.text === "string") {
      out.push({ type: "fill", target, text: o.text });
      continue;
    }
    if (type === "type" && typeof o.text === "string") {
      out.push({
        type: "type",
        target,
        text: o.text,
        charDelayMs: typeof o.charDelayMs === "number" ? o.charDelayMs : undefined,
      });
    }
  }
  return out;
}

export function describeOpenflowUiCommand(cmd: OpenflowAgentCommand): string {
  switch (cmd.type) {
    case "snapshot":
      return "UI snapshot (no-op at apply)";
    case "wait":
      return `Wait ${cmd.ms}ms`;
    case "press":
      return `Key ${cmd.key}`;
    case "click":
      return `Click ${describeTarget(cmd.target)}`;
    case "dblclick":
      return `Double-click ${describeTarget(cmd.target)}`;
    case "hover":
      return `Hover ${describeTarget(cmd.target)}`;
    case "scrollIntoView":
      return `Scroll into view ${describeTarget(cmd.target)}`;
    case "waitFor":
      return `Wait for ${describeTarget(cmd.target)}`;
    case "fill":
      return `Fill ${describeTarget(cmd.target)}`;
    case "type":
      return `Type into ${describeTarget(cmd.target)}`;
    default:
      return "UI command";
  }
}

function describeTarget(t: OpenflowAgentTarget): string {
  switch (t.kind) {
    case "ref":
      return `ref:${t.ref}`;
    case "dataId":
      return `data-id:${t.value}`;
    case "agentNodeType":
      return `menu:${t.nodeType}`;
    case "flowNode":
      return `node:${t.nodeId}`;
    case "handle":
      return `handle:${t.nodeId}${t.handleId ? `/${t.handleId}` : ""}`;
    default:
      return "?";
  }
}
