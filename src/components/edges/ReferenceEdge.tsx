"use client";

import { useMemo } from "react";
import {
  BaseEdge,
  EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";

export function ReferenceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  source,
  target,
}: EdgeProps) {
  // Narrow selector: returns boolean, only re-renders when selection relevance changes
  const isConnectedToSelection = useWorkflowStore((state) => {
    const selectedNodes = state.nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return false;
    return selectedNodes.some((n) => n.id === source || n.id === target);
  });

  // Calculate the path - always use curved for reference edges for softer look
  const [edgePath] = useMemo(() => {
    return getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: 0.25,
    });
  }, [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition]);

  // Per-edge gradient defs (must live in the same SVG as the path)
  const gradientId = useMemo(() => `edge-grad-${id}`, [id]);
  const gradientOpacity = isConnectedToSelection ? { a: 1, mid: 0.55 } : { a: 0.25, mid: 0.1 };

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#52525b" stopOpacity={gradientOpacity.a} />
          <stop offset="50%" stopColor="#52525b" stopOpacity={gradientOpacity.mid} />
          <stop offset="100%" stopColor="#52525b" stopOpacity={gradientOpacity.a} />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: `url(#${gradientId})`,
          strokeWidth: 2,
          strokeDasharray: "6 4",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      />

      {/* Invisible wider path for easier selection */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={10}
        stroke="transparent"
        className="react-flow__edge-interaction"
      />
    </>
  );
}
