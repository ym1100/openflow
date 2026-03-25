"use client";

import { type FormEventHandler, useCallback, useMemo, useRef, useState } from "react";
import { NodeProps, Node, useReactFlow } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useToast } from "@/components/Toast";
import type { CommentEntry, CommentNodeData } from "@/types";

type CommentNodeType = Node<CommentNodeData, "comment">;

function getTimeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return "now";
  if (diffInSeconds < 120) return "1 min ago";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min ago`;
  if (diffInSeconds < 7200) return "1 hr ago";
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hr ago`;
  if (diffInSeconds < 172800) return "1 day ago";
  return `${Math.floor(diffInSeconds / 86400)} days ago`;
}

function getInitials(author: string) {
  return author.slice(0, 2).toUpperCase();
}

const DEFAULT_AUTHOR = "User";
const AGENT_AUTHOR = "Flowy";

function isAgentEntry(entry: CommentEntry) {
  return entry.authorType === "agent" || entry.author === AGENT_AUTHOR;
}

function getAttachedTargetLabel(
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>,
  attachedId: string | null | undefined
): { short: string; missing: boolean } {
  if (!attachedId?.trim()) return { short: "", missing: false };
  const n = nodes.find((x) => x.id === attachedId);
  if (!n) return { short: attachedId.slice(0, 14), missing: true };
  const raw = n.data?.customTitle;
  const title = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 28) : "";
  const kind = n.type || "node";
  return { short: title ? `${kind}: ${title}` : kind, missing: false };
}

/** Avatar circle — indigo for agent, neutral for user */
function Avatar({ entry, size = "md" }: { entry: CommentEntry; size?: "sm" | "md" }) {
  const agent = isAgentEntry(entry);
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  if (agent) {
    return (
      <div
        className={`${dim} shrink-0 rounded-full bg-indigo-700 flex items-center justify-center text-indigo-100 ring-1 ring-indigo-500`}
        title="Flowy AI"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"}>
          <path d="M8 1l1.545 4.755H15l-4.045 2.94 1.545 4.755L8 10.51l-4.5 2.94 1.545-4.755L1 5.755h5.455z" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`${dim} shrink-0 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-300 ring-1 ring-neutral-500`}>
      {getInitials(entry.author || DEFAULT_AUTHOR)}
    </div>
  );
}

export function CommentNode({ data, id, selected = false }: NodeProps<CommentNodeType>) {
  const [inputValue, setInputValue] = useState("");
  const [replyValue, setReplyValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const { getNodes } = useReactFlow();

  const attachedId = data.attachedToNodeId?.trim() || null;
  const attachedLabel = useMemo(
    () => getAttachedTargetLabel(nodes, attachedId),
    [nodes, attachedId]
  );

  const handleAttachToSelection = useCallback(() => {
    const sel = getNodes().filter(
      (n) => n.selected && n.id !== id && n.type !== "comment"
    );
    if (sel.length !== 1) {
      useToast
        .getState()
        .show("Select exactly one non-comment node, then click Link", "warning");
      return;
    }
    updateNodeData(id, { attachedToNodeId: sel[0].id });
    useToast.getState().show("Comment linked to node", "success");
  }, [getNodes, id, updateNodeData]);

  const handleClearAttachment = useCallback(() => {
    updateNodeData(id, { attachedToNodeId: null });
  }, [id, updateNodeData]);

  const entries: CommentEntry[] = data.content
    ? Array.isArray(data.content)
      ? data.content
      : [data.content as CommentEntry]
    : [];

  const resolved = Boolean(data.resolved);
  const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  // ── helpers ────────────────────────────────────────────────────────────────

  const handleSubmitNew: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || loading) return;
    setLoading(true);
    const newEntry: CommentEntry = {
      id: `comment-${Date.now()}`,
      text,
      author: DEFAULT_AUTHOR,
      authorType: "user",
      date: new Date().toISOString(),
    };
    updateNodeData(id, { content: [newEntry] });
    setInputValue("");
    setLoading(false);
  };

  const handleSubmitReply: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    const text = replyValue.trim();
    if (!text || loading) return;
    setLoading(true);
    const newEntry: CommentEntry = {
      id: `comment-${Date.now()}`,
      text,
      author: DEFAULT_AUTHOR,
      authorType: "user",
      date: new Date().toISOString(),
    };
    updateNodeData(id, { content: [...entries, newEntry] });
    setReplyValue("");
    setLoading(false);
  };

  const handleStartEdit = (entry: CommentEntry) => {
    setEditTargetId(entry.id);
    setEditValue(entry.text);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editValue.trim() || !editTargetId || loading) return;
    setLoading(true);
    const updated = entries.map((e) =>
      e.id === editTargetId ? { ...e, text: editValue.trim() } : e
    );
    updateNodeData(id, { content: updated });
    setIsEditing(false);
    setEditValue("");
    setEditTargetId(null);
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue("");
    setEditTargetId(null);
  };

  const handleResolve = () => {
    updateNodeData(id, { resolved: true, resolvedAt: new Date().toISOString() });
  };

  const handleUnresolve = () => {
    updateNodeData(id, { resolved: false, resolvedAt: undefined });
  };

  const handleDelete = () => {
    removeNode(id);
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selected) {
      onNodesChange([{ type: "select", id, selected: false }]);
    } else {
      const changes = nodes
        .filter((n) => n.id !== id)
        .map((n) => ({ type: "select" as const, id: n.id, selected: false }))
        .concat([{ type: "select" as const, id, selected: true }]);
      onNodesChange(changes);
    }
  };

  // ── empty state ────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    const ghostEntry: CommentEntry = { id: "ghost", text: "", author: DEFAULT_AUTHOR, authorType: "user", date: new Date().toISOString() };
    return (
      <div className="relative p-3 rounded-2xl bg-neutral-800 ring-1 ring-neutral-600 min-w-[320px] w-full overflow-hidden">
        <form onSubmit={handleSubmitNew} className="flex items-center gap-3 min-w-0">
          <Avatar entry={ghostEntry} />
          <input
            type="text"
            placeholder="Leave a comment…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 min-w-0 rounded-xl bg-neutral-700 border border-neutral-600 px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            disabled={loading}
          />
          <button
            type="submit"
            className="h-8 w-8 rounded-full shrink-0 bg-white text-neutral-900 flex items-center justify-center hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            disabled={loading || !inputValue.trim()}
          >
            {loading ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </form>
      </div>
    );
  }

  // ── bubble ring color based on state ──────────────────────────────────────

  const isAgentComment = latestEntry ? isAgentEntry(latestEntry) : false;
  const ringClass = resolved
    ? "ring-green-700"
    : isAgentComment
    ? "ring-indigo-600"
    : "ring-neutral-600";

  // ── has content ────────────────────────────────────────────────────────────

  return (
    <div className="group relative" data-id="comment-body" data-state={selected ? "open" : "closed"}>
      <div
        className={`absolute -left-3 -top-3 ${selected ? "pointer-events-auto" : "pointer-events-none group-hover:pointer-events-auto"}`}
        data-id="comment-body-open"
      >
        {/* ── top toolbar ── */}
        {selected && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2 pb-2 pointer-events-auto z-10">
            <div className="flex h-10 items-center rounded-2xl bg-neutral-800 ring-1 ring-neutral-600 px-1 gap-0.5">
              {resolved ? (
                <>
                  {/* Unresolve */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleUnresolve(); }}
                    className="h-8 px-2.5 flex items-center gap-1.5 rounded-2xl text-green-400 hover:bg-neutral-700 hover:text-green-300 transition-colors text-xs font-medium"
                    title="Unresolve"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    Unresolve
                  </button>
                  {/* Delete */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                    className="h-8 w-8 flex items-center justify-center rounded-xl text-neutral-400 hover:bg-red-900/40 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleAttachToSelection(); }}
                    className="h-8 px-2 flex items-center justify-center rounded-xl text-neutral-300 hover:bg-neutral-700 hover:text-sky-300 transition-colors text-[11px] font-medium gap-1"
                    title="Link to selected node (select one other node first)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Link
                  </button>
                  {attachedId ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleClearAttachment(); }}
                      className="h-8 px-2 flex items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors text-[11px]"
                      title="Remove link"
                    >
                      Unlink
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {/* Resolve */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleResolve(); }}
                    className="h-8 w-8 flex items-center justify-center rounded-2xl text-neutral-300 hover:bg-neutral-700 hover:text-green-400 transition-colors"
                    title="Mark resolved"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
                      <path d="m9 11 3 3L22 4" />
                    </svg>
                  </button>
                  {/* Edit latest */}
                  {latestEntry && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleStartEdit(latestEntry); }}
                      className="h-8 w-8 flex items-center justify-center rounded-xl text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
                      title="Edit"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                  )}
                  {/* Delete */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                    className="h-8 w-8 flex items-center justify-center rounded-xl text-neutral-400 hover:bg-red-900/40 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                  {/* Link to canvas node */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleAttachToSelection(); }}
                    className="h-8 px-2 flex items-center justify-center rounded-xl text-neutral-300 hover:bg-neutral-700 hover:text-sky-300 transition-colors text-[11px] font-medium gap-1"
                    title="Link to selected node (select one other node first)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Link
                  </button>
                  {attachedId ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleClearAttachment(); }}
                      className="h-8 px-2 flex items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors text-[11px]"
                      title="Remove link"
                    >
                      Unlink
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── expanded bubble ── */}
        <div
          className={`flex flex-col gap-0 rounded-2xl transition-transform bg-neutral-800 ring-1 ${ringClass} ${
            selected ? "scale-100 w-fit min-w-[16rem] max-w-[28rem]" : "scale-0 group-hover:scale-100 origin-[2rem_2rem] w-64"
          } ${resolved ? "opacity-75" : ""}`}
        >
          {/* thread entries */}
          <div className="flex flex-col gap-0 px-3 pt-3 pb-2">
            {attachedId ? (
              <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-sky-800/50 bg-sky-950/40 px-2 py-1.5 text-[10px] text-sky-100/90">
                <span className="shrink-0 font-medium text-sky-400">Linked to</span>
                <span
                  className="min-w-0 truncate font-mono text-sky-200/95"
                  title={attachedLabel.missing ? attachedId : `${attachedId} (${attachedLabel.short})`}
                >
                  {attachedLabel.missing ? `missing node ${attachedLabel.short}` : attachedLabel.short}
                </span>
              </div>
            ) : null}
            {entries.map((entry, idx) => {
              const agent = isAgentEntry(entry);
              const isEditingThis = isEditing && editTargetId === entry.id;

              return (
                <div key={entry.id} className={`flex gap-2 ${idx > 0 ? "mt-3 pt-3 border-t border-neutral-700" : ""}`}>
                  <div className="shrink-0 pt-0.5">
                    <Avatar entry={entry} />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-h-5">
                      <span className={`text-xs font-medium truncate ${agent ? "text-indigo-300" : "text-neutral-200"}`}>
                        {entry.author || DEFAULT_AUTHOR}
                      </span>
                      {agent && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 font-medium leading-none">
                          AI
                        </span>
                      )}
                      <span className="shrink-0 text-neutral-500 text-[11px] ml-auto">
                        {getTimeAgo(entry.date)}
                      </span>
                    </div>

                    {isEditingThis ? (
                      <div className="flex flex-col gap-1.5 mt-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full rounded-lg bg-neutral-700 border border-neutral-600 px-2.5 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                          disabled={loading}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                            else if (e.key === "Escape") handleCancelEdit();
                          }}
                        />
                        <div className="flex gap-1.5 justify-end">
                          <button type="button" onClick={handleCancelEdit} className="h-6 px-2 text-xs text-neutral-400 hover:text-neutral-100">
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={loading || !editValue.trim()}
                            className="h-6 px-2.5 text-xs bg-white text-neutral-900 rounded-lg hover:bg-neutral-200 disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`text-sm text-neutral-100 pr-2 ${
                          selected ? "whitespace-pre-wrap break-words" : "line-clamp-3"
                        } ${resolved ? "line-through decoration-neutral-500 text-neutral-400" : ""}`}
                      >
                        {entry.text}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* resolved badge */}
          {resolved && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-t border-neutral-700 text-green-500 text-xs">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21.801 10A10 10 0 1 1 17 3.335" /><path d="m9 11 3 3L22 4" />
              </svg>
              Resolved
              {data.resolvedAt && (
                <span className="text-neutral-500 ml-1">{getTimeAgo(data.resolvedAt)}</span>
              )}
            </div>
          )}

          {/* reply input (shown when selected and not resolved) */}
          {selected && !resolved && (
            <form
              onSubmit={handleSubmitReply}
              className="flex items-center gap-2 px-3 py-2 border-t border-neutral-700"
            >
              <input
                ref={replyInputRef}
                type="text"
                placeholder="Reply…"
                value={replyValue}
                onChange={(e) => setReplyValue(e.target.value)}
                className="flex-1 min-w-0 rounded-lg bg-neutral-700 border border-neutral-600 px-2.5 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                disabled={loading}
              />
              <button
                type="submit"
                className="h-7 w-7 rounded-full shrink-0 bg-white text-neutral-900 flex items-center justify-center hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                disabled={loading || !replyValue.trim()}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ── collapsed avatar pill ── */}
      <div
        className={`relative h-8 w-8 shrink-0 rounded-full border p-px cursor-pointer overflow-hidden flex items-center justify-center transition-colors ${
          resolved
            ? "border-green-700 bg-green-900/40 text-green-300"
            : isAgentComment
            ? "border-indigo-600 bg-indigo-900/60 text-indigo-200"
            : "border-neutral-600 bg-neutral-700 text-neutral-300 hover:border-neutral-500"
        }`}
        data-id="comment-avatar"
        onClick={handleAvatarClick}
        title={resolved ? "Resolved" : isAgentComment ? "Flowy AI comment" : "Comment"}
      >
        {resolved ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m5 12 5 5L20 7" />
          </svg>
        ) : isAgentComment ? (
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M8 1l1.545 4.755H15l-4.045 2.94 1.545 4.755L8 10.51l-4.5 2.94 1.545-4.755L1 5.755h5.455z" />
          </svg>
        ) : (
          <span className="text-xs">{getInitials(latestEntry?.author || DEFAULT_AUTHOR)}</span>
        )}
      </div>
    </div>
  );
}
