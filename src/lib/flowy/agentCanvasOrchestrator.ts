import type { EditOperation } from "@/lib/chat/editOperations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MouseAction =
  | { kind: "move"; x: number; y: number; duration: number }
  | { kind: "click"; x: number; y: number }
  | { kind: "clickElement"; selector: string }
  | { kind: "waitForElement"; selector: string; timeout: number }
  | { kind: "typeText"; nodeId: string; field: "prompt" | "inputPrompt"; text: string; charDelay: number }
  | { kind: "storeCall"; label: string; fn: () => void }
  | { kind: "pause"; ms: number };

export interface CursorState {
  x: number;
  y: number;
  actionLabel: string;
  clickRipple: { x: number; y: number; id: number } | null;
}

type CursorSetter = (state: Partial<CursorState>) => void;
type SleepFn = (ms: number) => Promise<void>;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getElementCenter(selector: string): { x: number; y: number } | null {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function getNodeScreenCenter(nodeId: string): { x: number; y: number } | null {
  const el = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
  ) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function getNodeTextarea(nodeId: string): HTMLTextAreaElement | null {
  const nodeEl = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
  );
  if (!nodeEl) return null;
  return nodeEl.querySelector("textarea") as HTMLTextAreaElement | null;
}

function getHandleCenter(
  nodeId: string,
  handleId?: string
): { x: number; y: number } | null {
  const nodeEl = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
  );
  if (!nodeEl) return null;
  const handleSelector = handleId
    ? `.react-flow__handle[data-handleid="${CSS.escape(handleId)}"]`
    : ".react-flow__handle";
  const handle = nodeEl.querySelector(handleSelector) as HTMLElement | null;
  if (!handle) return null;
  const rect = handle.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// ---------------------------------------------------------------------------
// Smooth cursor motion
// ---------------------------------------------------------------------------

async function animateCursorTo(
  targetX: number,
  targetY: number,
  duration: number,
  setCursor: CursorSetter,
  sleepFn: SleepFn,
  currentPos: { x: number; y: number }
) {
  const steps = Math.max(6, Math.round(duration / 16));
  const dx = targetX - currentPos.x;
  const dy = targetY - currentPos.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    setCursor({
      x: currentPos.x + dx * ease,
      y: currentPos.y + dy * ease,
    });
    await sleepFn(16);
  }
  setCursor({ x: targetX, y: targetY });
}

// ---------------------------------------------------------------------------
// Click ripple
// ---------------------------------------------------------------------------

let rippleId = 0;

function emitClickRipple(x: number, y: number, setCursor: CursorSetter) {
  rippleId += 1;
  setCursor({ clickRipple: { x, y, id: rippleId } });
}

// ---------------------------------------------------------------------------
// Real DOM click
// ---------------------------------------------------------------------------

function clickElementAt(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      view: window,
    })
  );
}

// ---------------------------------------------------------------------------
// Typing simulation into a React-controlled textarea
// ---------------------------------------------------------------------------

async function simulateTyping(
  textarea: HTMLTextAreaElement,
  text: string,
  charDelay: number,
  sleepFn: SleepFn
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
    await sleepFn(charDelay);
  }
}

// ---------------------------------------------------------------------------
// Main executor: runs a single EditOperation as real mouse interactions
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  setCursor: CursorSetter;
  getCursorPos: () => { x: number; y: number };
  sleep: SleepFn;
  /** Applies one or more EditOperations via the existing store pipeline */
  applyOps: (ops: EditOperation[]) => void;
  storeUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
  flowToScreenPosition: (pos: { x: number; y: number }) => { x: number; y: number };
  setCenter: (x: number, y: number, opts?: { duration?: number; zoom?: number }) => void;
  getViewportZoom: () => number;
}

export async function executeOperationWithMouse(
  op: EditOperation,
  deps: OrchestratorDeps
): Promise<string | null> {
  const { setCursor, getCursorPos, sleep } = deps;

  switch (op.type) {
    case "addNode":
      return await executeAddNode(op, deps);
    case "updateNode":
      return await executeUpdateNode(op, deps);
    case "addEdge":
      return await executeAddEdge(op, deps);
    case "removeNode":
      return await executeRemoveNode(op, deps);
    case "moveNode":
      return await executeMoveNode(op, deps);
    default:
      setCursor({ actionLabel: op.type });
      deps.applyOps([op]);
      await sleep(200);
      return null;
  }
}

// ---------------------------------------------------------------------------
// addNode: click toolbar → click menu item → move node to position → type prompt
// ---------------------------------------------------------------------------

async function executeAddNode(
  op: Extract<EditOperation, { type: "addNode" }>,
  deps: OrchestratorDeps
): Promise<string | null> {
  const { setCursor, getCursorPos, sleep } = deps;

  setCursor({ actionLabel: "opening toolbar" });

  // 1. Move cursor to the "+" button
  const toolbarBtn = getElementCenter('[data-id="add-node-button"]');
  if (toolbarBtn) {
    await animateCursorTo(toolbarBtn.x, toolbarBtn.y, 350, setCursor, sleep, getCursorPos());
    await sleep(120);

    // 2. Click the "+" button (real DOM click)
    const btnEl = document.querySelector('[data-id="add-node-button"]') as HTMLElement;
    if (btnEl) {
      emitClickRipple(toolbarBtn.x, toolbarBtn.y, setCursor);
      clickElementAt(btnEl);
      await sleep(280);
    }
  }

  // 3. Wait for menu to appear and find the target node type
  setCursor({ actionLabel: `selecting ${op.nodeType}` });
  const menuItemSelector = `[data-agent-node-type="${op.nodeType}"]`;
  let attempts = 0;
  let menuItemPos: { x: number; y: number } | null = null;
  while (attempts < 15) {
    menuItemPos = getElementCenter(menuItemSelector);
    if (menuItemPos) break;
    await sleep(80);
    attempts++;
  }

  if (menuItemPos) {
    // 4. Move cursor to the menu item
    await animateCursorTo(menuItemPos.x, menuItemPos.y, 250, setCursor, sleep, getCursorPos());
    await sleep(100);

    // 5. Click the menu item (real DOM click — this triggers the real addNode)
    const menuItemEl = document.querySelector(menuItemSelector) as HTMLElement;
    if (menuItemEl) {
      emitClickRipple(menuItemPos.x, menuItemPos.y, setCursor);
      clickElementAt(menuItemEl);
      await sleep(200);
    }
  } else {
    // Fallback: apply via store if menu item not found
    deps.applyOps([op]);
    await sleep(200);
  }

  // 6. The node was added at pane center. If a specific position is requested, move it.
  //    Find the most recently added node of this type.
  await sleep(150);
  const allNodes = document.querySelectorAll(
    `.react-flow__node[data-id^="${op.nodeType}"]`
  );
  const latestNode = allNodes[allNodes.length - 1] as HTMLElement | null;
  const nodeId = latestNode?.getAttribute("data-id") ?? op.nodeId ?? null;

  if (nodeId && op.position) {
    setCursor({ actionLabel: "positioning" });
    const targetScreen = deps.flowToScreenPosition(op.position);
    const nodeCenter = getNodeScreenCenter(nodeId);
    if (nodeCenter) {
      await animateCursorTo(targetScreen.x, targetScreen.y, 300, setCursor, sleep, getCursorPos());
    }
    deps.storeUpdateNodeData(nodeId, { _agentTouched: Date.now() });
    deps.applyOps([{ type: "moveNode", nodeId, position: op.position }]);
    await sleep(100);
  }

  // 7. If there's prompt data to type, simulate typing
  const promptText =
    (op.data as any)?.prompt ??
    (op.data as any)?.inputPrompt ??
    null;

  if (promptText && nodeId) {
    await typePromptIntoNode(nodeId, promptText, op.nodeType, deps);
  } else if (op.data && nodeId) {
    // Apply other data fields via store (model, aspect ratio, etc.)
    deps.storeUpdateNodeData(nodeId, {
      ...(op.data as Record<string, unknown>),
      _agentTouched: Date.now(),
    });
  }

  // Pan canvas to show the new node
  if (op.position) {
    deps.setCenter(op.position.x + 150, op.position.y + 75, {
      duration: 400,
      zoom: deps.getViewportZoom(),
    });
  }

  return nodeId;
}

// ---------------------------------------------------------------------------
// updateNode: move cursor to node → click textarea → type
// ---------------------------------------------------------------------------

async function executeUpdateNode(
  op: Extract<EditOperation, { type: "updateNode" }>,
  deps: OrchestratorDeps
): Promise<null> {
  const { setCursor, getCursorPos, sleep } = deps;

  setCursor({ actionLabel: "editing" });

  // Move cursor to the node
  const nodeCenter = getNodeScreenCenter(op.nodeId);
  if (nodeCenter) {
    await animateCursorTo(nodeCenter.x, nodeCenter.y, 300, setCursor, sleep, getCursorPos());
    emitClickRipple(nodeCenter.x, nodeCenter.y, setCursor);
    await sleep(150);
  }

  // Check if there's a prompt to type
  const promptText =
    (op.data as any)?.prompt ??
    (op.data as any)?.inputPrompt ??
    null;

  if (promptText) {
    // Find the node type to determine the textarea approach
    const nodeEl = document.querySelector(
      `.react-flow__node[data-id="${CSS.escape(op.nodeId)}"]`
    );
    const nodeType = nodeEl?.getAttribute("data-id")?.split("-")[0] ?? "prompt";
    await typePromptIntoNode(op.nodeId, promptText, nodeType, deps);

    // Apply remaining data (minus prompt fields) via store
    const restData = { ...(op.data as Record<string, unknown>) };
    delete restData.prompt;
    delete restData.inputPrompt;
    if (Object.keys(restData).length > 0) {
      deps.storeUpdateNodeData(op.nodeId, { ...restData, _agentTouched: Date.now() });
    }
  } else {
    // No prompt text, apply all data via store
    deps.storeUpdateNodeData(op.nodeId, {
      ...(op.data as Record<string, unknown>),
      _agentTouched: Date.now(),
    });
    await sleep(100);
  }

  return null;
}

// ---------------------------------------------------------------------------
// addEdge: move cursor from source handle → target handle → connect via store
// ---------------------------------------------------------------------------

async function executeAddEdge(
  op: Extract<EditOperation, { type: "addEdge" }>,
  deps: OrchestratorDeps
): Promise<null> {
  const { setCursor, getCursorPos, sleep } = deps;

  setCursor({ actionLabel: "connecting" });

  // Move to source handle
  const sourceHandle = getHandleCenter(op.source, op.sourceHandle);
  const sourceNode = getNodeScreenCenter(op.source);
  const sourcePos = sourceHandle ?? sourceNode;
  if (sourcePos) {
    await animateCursorTo(sourcePos.x, sourcePos.y, 300, setCursor, sleep, getCursorPos());
    emitClickRipple(sourcePos.x, sourcePos.y, setCursor);
    await sleep(200);
  }

  // Move to target handle
  const targetHandle = getHandleCenter(op.target, op.targetHandle);
  const targetNode = getNodeScreenCenter(op.target);
  const targetPos = targetHandle ?? targetNode;
  if (targetPos) {
    await animateCursorTo(targetPos.x, targetPos.y, 400, setCursor, sleep, getCursorPos());
    emitClickRipple(targetPos.x, targetPos.y, setCursor);
    await sleep(150);
  }

  // Create the connection via the store pipeline
  deps.applyOps([op]);
  await sleep(200);

  return null;
}

// ---------------------------------------------------------------------------
// removeNode: move cursor to node → use store (keyboard delete)
// ---------------------------------------------------------------------------

async function executeRemoveNode(
  op: Extract<EditOperation, { type: "removeNode" }>,
  deps: OrchestratorDeps
): Promise<null> {
  const { setCursor, getCursorPos, sleep } = deps;

  setCursor({ actionLabel: "removing" });

  const nodeCenter = getNodeScreenCenter(op.nodeId);
  if (nodeCenter) {
    await animateCursorTo(nodeCenter.x, nodeCenter.y, 300, setCursor, sleep, getCursorPos());
    emitClickRipple(nodeCenter.x, nodeCenter.y, setCursor);
    await sleep(200);
  }

  deps.applyOps([op]);
  await sleep(200);

  return null;
}

// ---------------------------------------------------------------------------
// moveNode: animate cursor to new position → store move
// ---------------------------------------------------------------------------

async function executeMoveNode(
  op: Extract<EditOperation, { type: "moveNode" }>,
  deps: OrchestratorDeps
): Promise<null> {
  const { setCursor, getCursorPos, sleep } = deps;

  setCursor({ actionLabel: "moving" });

  const nodeCenter = getNodeScreenCenter(op.nodeId);
  if (nodeCenter) {
    await animateCursorTo(nodeCenter.x, nodeCenter.y, 250, setCursor, sleep, getCursorPos());
    await sleep(100);
  }

  const targetScreen = deps.flowToScreenPosition(op.position);
  await animateCursorTo(targetScreen.x, targetScreen.y, 400, setCursor, sleep, getCursorPos());
  emitClickRipple(targetScreen.x, targetScreen.y, setCursor);

  deps.applyOps([op]);
  await sleep(150);

  return null;
}

// ---------------------------------------------------------------------------
// Shared: type prompt text into a node's textarea
// ---------------------------------------------------------------------------

async function typePromptIntoNode(
  nodeId: string,
  text: string,
  nodeType: string,
  deps: OrchestratorDeps
) {
  const { setCursor, getCursorPos, sleep } = deps;

  setCursor({ actionLabel: "typing" });

  // Find the textarea inside the node
  const textarea = getNodeTextarea(nodeId);
  if (textarea) {
    const rect = textarea.getBoundingClientRect();
    const textareaCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    await animateCursorTo(textareaCenter.x, textareaCenter.y, 200, setCursor, sleep, getCursorPos());
    emitClickRipple(textareaCenter.x, textareaCenter.y, setCursor);
    await sleep(100);

    // Simulate real typing character by character
    const charDelay = Math.max(8, Math.min(25, 1200 / text.length));
    await simulateTyping(textarea, text, charDelay, sleep);
    await sleep(80);
  } else {
    // Fallback: apply via store
    const field = nodeType === "prompt" ? "prompt" : "inputPrompt";
    deps.storeUpdateNodeData(nodeId, { [field]: text, _agentTouched: Date.now() });
    await sleep(100);
  }
}
