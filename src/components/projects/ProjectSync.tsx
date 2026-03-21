"use client";

import { useEffect } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { updateProject } from "@/lib/local-db";

type ProjectSyncProps = {
  projectId: string;
};

function buildWorkflow(
  projectId: string,
  nodes: ReturnType<typeof useWorkflowStore.getState>["nodes"],
  edges: ReturnType<typeof useWorkflowStore.getState>["edges"],
  groups: ReturnType<typeof useWorkflowStore.getState>["groups"],
  edgeStyle: ReturnType<typeof useWorkflowStore.getState>["edgeStyle"],
  workflowName: string | null
) {
  return {
    version: 1 as const,
    id: projectId,
    name: workflowName || "Untitled Project",
    nodes: nodes.map(({ selected, ...rest }) => rest),
    edges,
    edgeStyle,
    groups: groups && Object.keys(groups).length > 0 ? groups : undefined,
  };
}

export function ProjectSync({ projectId }: ProjectSyncProps) {
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const groups = useWorkflowStore((state) => state.groups);
  const edgeStyle = useWorkflowStore((state) => state.edgeStyle);
  const workflowName = useWorkflowStore((state) => state.workflowName);
  useEffect(() => {
    const workflow = buildWorkflow(
      projectId,
      nodes,
      edges,
      groups,
      edgeStyle,
      workflowName
    );
    updateProject(projectId, {
      name: workflow.name,
      content: workflow,
    }).catch((err) => console.error("Failed to save project:", err));
  }, [projectId, nodes, edges, groups, edgeStyle, workflowName]);

  return null;
}
