"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useReactFlow } from "@xyflow/react";
import type { NodeType } from "@/types";
import { ALL_NODES_CATEGORIES } from "@/lib/node-categories";

interface CanvasContextMenuProps {
  position: { x: number; y: number };
  nodeId?: string;
  onClose: () => void;
}

export function CanvasContextMenu({ position, nodeId, onClose }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const addNode = useWorkflowStore((state) => state.addNode);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const executeWorkflow = useWorkflowStore((state) => state.executeWorkflow);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const { screenToFlowPosition } = useReactFlow();

  const flowPosition = screenToFlowPosition({ x: position.x, y: position.y });

  const handleDeleteNode = useCallback(() => {
    if (nodeId) {
      removeNode(nodeId);
      onClose();
    }
  }, [nodeId, removeNode, onClose]);

  const handleRunFromNode = useCallback(() => {
    if (nodeId) {
      executeWorkflow(nodeId);
      onClose();
    }
  }, [nodeId, executeWorkflow, onClose]);

  const handleRunNodeOnly = useCallback(() => {
    if (nodeId) {
      regenerateNode(nodeId);
      onClose();
    }
  }, [nodeId, regenerateNode, onClose]);

  const handleAddNode = useCallback(
    (type: NodeType) => {
      addNode(type, flowPosition);
      onClose();
    },
    [addNode, flowPosition, onClose]
  );

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const panelClassName =
    "fixed z-[200] w-80 max-w-80 rounded-xl border border-neutral-700/40 bg-[var(--background-transparent-black-default)] backdrop-blur-lg overflow-hidden";

  const sectionTitleClassName =
    "select-none px-3 py-2 text-[11px] text-neutral-400";

  const rowClassName =
    "w-full rounded-lg px-4 pl-2 flex h-[51px] justify-start gap-2 whitespace-normal bg-transparent font-normal text-[12px] text-neutral-200 hover:bg-white/10 transition-colors items-center text-left";

  const iconTileClassName =
    "flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-950/60 p-2 text-neutral-300";

  if (nodeId) {
    return (
      <div
        ref={menuRef}
        className={panelClassName}
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <div className="flex flex-col px-1 py-1">
          <div className={sectionTitleClassName}>Node</div>
          <button
            onClick={handleDeleteNode}
            className={`${rowClassName} text-red-300 hover:text-red-200`}
          >
            <div className={iconTileClassName}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <div className="relative flex h-8 items-center text-left">
              <span className="select-none truncate">Delete node</span>
            </div>
          </button>
          <button
            onClick={handleRunFromNode}
            className={rowClassName}
          >
            <div className={iconTileClassName}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <div className="relative flex h-8 items-center text-left">
              <span className="select-none truncate">Run from selected node</span>
            </div>
          </button>
          <button
            onClick={handleRunNodeOnly}
            className={rowClassName}
          >
            <div className={iconTileClassName}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <div className="relative flex h-8 items-center text-left">
              <span className="select-none truncate">Run selected node only</span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className={panelClassName}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="flex flex-col px-1 py-1">
        <div className={sectionTitleClassName}>Add Node</div>
      </div>
      <div className="px-1 py-1 max-h-[320px] overflow-y-auto">
        {ALL_NODES_CATEGORIES.map((category, catIndex) => (
          <div key={category.label}>
            <div
              className={`select-none px-3 py-2 text-[10px] text-neutral-500 uppercase tracking-wide${
                catIndex > 0 ? " border-t border-neutral-800/60" : ""
              }`}
            >
              {category.label}
            </div>
            {category.nodes.map((node) => (
              <button
                key={node.type}
                onClick={() => handleAddNode(node.type)}
                className={rowClassName}
              >
                <div className={iconTileClassName}>
                  <span className="text-[11px] font-medium">{node.label.slice(0, 1).toUpperCase()}</span>
                </div>
                <div className="relative flex h-8 items-center text-left">
                  <span className="select-none truncate">{node.label}</span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
