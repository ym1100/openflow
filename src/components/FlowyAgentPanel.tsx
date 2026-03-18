"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditOperation } from "@/lib/chat/editOperations";

type WorkflowState = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
};

type FlowyPlanResponse = {
  assistantText: string;
  operations: EditOperation[];
  requiresApproval?: boolean;
  approvalReason?: string;
};

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export function FlowyAgentPanel({
  isOpen,
  onClose,
  onApplyEdits,
  workflowState,
  selectedNodeIds,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApplyEdits?: (operations: EditOperation[]) => { applied: number; skipped: string[] };
  workflowState?: WorkflowState;
  selectedNodeIds?: string[];
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [isPlanning, setIsPlanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [pendingOperations, setPendingOperations] = useState<EditOperation[] | null>(null);
  const [pendingExplanation, setPendingExplanation] = useState<string | null>(null);
  const [executionIndex, setExecutionIndex] = useState<number>(0);
  const [applyMode, setApplyMode] = useState<"manual" | "auto">("manual");
  const [cursor, setCursor] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [isExecutingStep, setIsExecutingStep] = useState(false);
  const autoRunIdRef = useRef(0);

  const stateForRequest = useMemo(() => {
    // Ensure we always send a consistent shape.
    if (!workflowState) return undefined;
    return {
      nodes: workflowState.nodes,
      edges: workflowState.edges,
    };
  }, [workflowState]);

  const selectedContextSummary = useMemo(() => {
    const ids = selectedNodeIds ?? [];
    if (!workflowState || ids.length === 0) return null;
    const types = workflowState.nodes
      .filter((n) => ids.includes(n.id))
      .map((n) => n.type)
      .filter(Boolean);
    const unique = Array.from(new Set(types));
    return { count: ids.length, types: unique.slice(0, 4) };
  }, [selectedNodeIds, workflowState]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handlePlan = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isPlanning) return;

    setErrorMessage(null);
    setIsPlanning(true);

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", text: trimmed };
    setChatMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const res = await fetch("/api/flowy/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          workflowState: stateForRequest,
          selectedNodeIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Plan failed (${res.status})`);
      }

      const data = (await res.json()) as ({ ok: boolean; error?: string } & FlowyPlanResponse);
      if (!data.ok) throw new Error(data.error || "Plan failed");

      const assistantText = data.assistantText ?? "";
      const ops = data.operations ?? [];

      setPendingOperations(ops);
      setPendingExplanation(assistantText);
      setExecutionIndex(0);
      setCursor((c) => ({ ...c, visible: false }));
      setChatMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: assistantText },
      ]);

      // Assist mode: always propose first.
      scrollToBottom();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to plan edits");
    } finally {
      setIsPlanning(false);
    }
  }, [input, isPlanning, selectedNodeIds, scrollToBottom, stateForRequest]);

  const handleApprove = useCallback(() => {
    // Keep for backward compatibility if a parent triggers bulk apply.
    if (!pendingOperations || !onApplyEdits) return;
    onApplyEdits(pendingOperations);
    setPendingOperations(null);
    setPendingExplanation(null);
    setExecutionIndex(0);
  }, [onApplyEdits, pendingOperations]);

  const stopAutoRun = useCallback(() => {
    // Increment run id so any in-flight auto loop will stop.
    autoRunIdRef.current += 1;
  }, []);

  const sleep = useCallback((ms: number) => new Promise((r) => setTimeout(r, ms)), []);

  const getNodeCenterScreen = useCallback((nodeId: string): { x: number; y: number } | null => {
    try {
      const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    } catch {
      return null;
    }
  }, []);

  const describeOperation = useCallback((op: EditOperation): string => {
    switch (op.type) {
      case "addNode":
        return `Add ${op.nodeType}`;
      case "removeNode":
        return `Remove node`;
      case "updateNode":
        return `Update node`;
      case "addEdge":
        return `Connect nodes`;
      case "removeEdge":
        return `Remove connection`;
    }
  }, []);

  const applyOperationAtIndex = useCallback(
    async (index: number) => {
      if (!pendingOperations || !onApplyEdits) return;
      if (index < 0 || index >= pendingOperations.length) return;

      const op = pendingOperations[index];
      setIsExecutingStep(true);

      try {
        // For addNode we need to apply first, because the node doesn't exist yet.
        if (op.type !== "addNode") {
          if (op.type === "removeNode" || op.type === "updateNode") {
            const center = getNodeCenterScreen(op.nodeId);
            if (center) setCursor({ x: center.x, y: center.y, visible: true });
          } else if (op.type === "addEdge") {
            const center = getNodeCenterScreen(op.source);
            if (center) setCursor({ x: center.x, y: center.y, visible: true });
          }
        }

        if (op.type === "addNode") {
          onApplyEdits([op]);
          await sleep(50);

          if (op.nodeId) {
            const center = getNodeCenterScreen(op.nodeId);
            if (center) setCursor({ x: center.x, y: center.y, visible: true });
            // brief settle time so the cursor motion feels "live"
            await sleep(150);
          }
        } else {
          onApplyEdits([op]);
          await sleep(50);

          const targetNodeId =
            op.type === "removeNode" || op.type === "updateNode" ? op.nodeId : undefined;
          if (targetNodeId) {
            const center = getNodeCenterScreen(targetNodeId);
            if (center) setCursor({ x: center.x, y: center.y, visible: true });
            await sleep(120);
          } else if (op.type === "addEdge") {
            const s = getNodeCenterScreen(op.source);
            if (s) setCursor({ x: s.x, y: s.y, visible: true });
            await sleep(80);
          }
        }

        setExecutionIndex(index + 1);
      } finally {
        setIsExecutingStep(false);
      }
    },
    [getNodeCenterScreen, onApplyEdits, pendingOperations, sleep]
  );

  const handleApproveStep = useCallback(async () => {
    await applyOperationAtIndex(executionIndex);
  }, [applyOperationAtIndex, executionIndex]);

  const resetExecution = useCallback(() => {
    setExecutionIndex(0);
    setIsExecutingStep(false);
    setCursor((c) => ({ ...c, visible: false }));
  }, []);

  // Auto-apply mode: run through all pending operations sequentially.
  useEffect(() => {
    if (!isOpen) return;
    if (applyMode !== "auto") return;
    if (!pendingOperations || !onApplyEdits) return;
    if (executionIndex !== 0) return;

    const runId = autoRunIdRef.current + 1;
    autoRunIdRef.current = runId;

    (async () => {
      for (let i = 0; i < pendingOperations.length; i++) {
        if (autoRunIdRef.current !== runId) return;
        await applyOperationAtIndex(i);
      }
    })();
    // No cleanup needed beyond runId checks.
  }, [applyMode, executionIndex, isOpen, onApplyEdits, pendingOperations, applyOperationAtIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-[90px] right-5 w-[380px] max-h-[70vh] bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl flex flex-col overflow-hidden z-40">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
        <h3 className="text-sm font-medium text-neutral-200">Flowy</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 transition-colors p-1"
            aria-label="Close Flowy panel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
        onWheelCapture={(e) => e.stopPropagation()}
        style={{ touchAction: "pan-y" }}
      >
        {selectedContextSummary && (
          <div className="bg-neutral-700/50 border border-neutral-600 rounded-lg px-3 py-2 text-xs text-neutral-300">
            Using your selected node context ({selectedContextSummary.count} selected):
            {" "}
            {selectedContextSummary.types.length ? selectedContextSummary.types.join(", ") : "nodes"}
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm text-red-200">
            {errorMessage}
            <button
              className="block text-xs text-red-300 hover:text-red-100 underline mt-2"
              onClick={() => setErrorMessage(null)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {chatMessages.length === 0 && !errorMessage && (
          <div className="text-center text-neutral-500 text-sm py-8">
            <p>Ask Flowy to modify your workflow.</p>
            <p className="text-xs mt-2">Example: “Make a video from this image with a cinematic style.”</p>
          </div>
        )}

        {chatMessages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-blue-600 text-white" : "bg-neutral-700 text-neutral-200"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          </div>
        ))}

        {pendingOperations && (
          <div className="mt-2 bg-neutral-700/50 border border-neutral-600 rounded-lg p-3">
            <div className="text-xs text-neutral-300">
              Assist mode: {pendingOperations.length} operation{pendingOperations.length !== 1 ? "s" : ""}
            </div>
            {pendingExplanation && (
              <div className="text-xs text-neutral-400 mt-1 whitespace-pre-wrap">{pendingExplanation}</div>
            )}

            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-neutral-400">Apply:</span>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                      applyMode === "manual"
                        ? "bg-blue-900/20 border-blue-700/50 text-blue-200"
                        : "bg-neutral-800/30 border-neutral-700 text-neutral-300 hover:text-neutral-100"
                    }`}
                    onClick={() => {
                      stopAutoRun();
                      setApplyMode("manual");
                    }}
                    aria-pressed={applyMode === "manual"}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                      applyMode === "auto"
                        ? "bg-green-900/20 border-green-700/50 text-green-200"
                        : "bg-neutral-800/30 border-neutral-700 text-neutral-300 hover:text-neutral-100"
                    }`}
                    onClick={() => {
                      setApplyMode("auto");
                    }}
                    aria-pressed={applyMode === "auto"}
                  >
                    Auto
                  </button>
                </div>

                <div className="text-xs text-neutral-300">
                  Step {Math.min(executionIndex + 1, pendingOperations.length)} / {pendingOperations.length}
                  {executionIndex >= pendingOperations.length ? " (done)" : ""}
                </div>
                <div className="text-[11px] text-neutral-400 mt-1 whitespace-pre-wrap">
                  {executionIndex >= pendingOperations.length
                    ? "All edits applied."
                    : describeOperation(pendingOperations[executionIndex])}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopAutoRun();
                    setPendingOperations(null);
                    setPendingExplanation(null);
                    resetExecution();
                  }}
                  className="px-3 py-2 text-xs text-neutral-300 hover:text-neutral-100 transition-colors rounded-lg border border-neutral-600 bg-neutral-800/40"
                >
                  Cancel
                </button>

                {applyMode === "auto" && executionIndex < pendingOperations.length && (
                  <button
                    type="button"
                    onClick={() => stopAutoRun()}
                    disabled={!isExecutingStep}
                    className="px-3 py-2 text-xs text-neutral-300 hover:text-neutral-100 transition-colors rounded-lg border border-neutral-600 bg-neutral-800/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Stop auto-run"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>

            {applyMode === "manual" && executionIndex < pendingOperations.length && onApplyEdits && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleApproveStep}
                  disabled={isExecutingStep}
                  className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExecutingStep ? "Applying..." : "Approve step"}
                </button>
              </div>
            )}

            {executionIndex >= pendingOperations.length && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    stopAutoRun();
                    setPendingOperations(null);
                    setPendingExplanation(null);
                    resetExecution();
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                >
                  Done
                </button>
              </div>
            )}

            {/* Timeline */}
            <div className="mt-3">
              <div className="text-[11px] text-neutral-400 mb-2">Timeline</div>
              <div className="grid grid-cols-1 gap-2">
                {pendingOperations.map((op, idx) => {
                  const status =
                    idx < executionIndex ? "done" : idx === executionIndex ? "next" : "pending";
                  const bg =
                    status === "done"
                      ? "bg-green-900/20 border-green-700/50 text-green-200"
                      : status === "next"
                        ? "bg-blue-900/20 border-blue-700/50 text-blue-200"
                        : "bg-neutral-800/30 border-neutral-700 text-neutral-300";
                  return (
                    <div
                      key={idx}
                      className={`border rounded-lg p-2 text-[11px] ${bg}`}
                      aria-current={status === "next"}
                    >
                      {idx + 1}. {describeOperation(op)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-neutral-700 p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handlePlan();
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Flowy..."
            className="flex-1 bg-neutral-700 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
            disabled={isPlanning}
          />
          <button
            type="submit"
            disabled={isPlanning || !input.trim()}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      </div>

      {/* Cursor overlay (purely visual, no DOM clicking) */}
      {cursor.visible && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            left: cursor.x,
            top: cursor.y,
            transform: "translate(-50%, -50%)",
            zIndex: 1000,
            pointerEvents: "none",
            transition: "left 220ms ease, top 220ms ease, opacity 220ms ease",
            opacity: isExecutingStep ? 1 : 0.95,
          }}
          className="w-5 h-5"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4v6h6" />
            <path d="M10 14l-6 6" />
            <path d="M14 10l6-6" />
            <path d="M13 7l4 4" />
          </svg>
        </div>
      )}
    </div>
  );
}

