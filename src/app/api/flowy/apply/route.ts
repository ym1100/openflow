import { applyEditOperations } from "@/lib/chat/editOperations";
import { NextResponse } from "next/server";
import { isFileProjectId, loadWorkflowFromFileProject, saveWorkflowToFileProject } from "@/lib/projectFileIO";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      projectId?: string;
      workflowState?: {
        nodes: any[];
        edges: any[];
      };
      operations?: any[];
    };

    const workflowStateFromBody = body.workflowState ?? null;
    const operations = body.operations ?? null;

    let loadedWorkflow: any | null = null;
    let filePath: string | null = null;

    let workflowState = workflowStateFromBody;
    if ((!workflowState || !Array.isArray(workflowState.nodes) || !Array.isArray(workflowState.edges)) && body.projectId) {
      if (!isFileProjectId(body.projectId)) {
        return NextResponse.json(
          { ok: false, error: "Server-side applying only supported for file projectIds (path-like ids)." },
          { status: 400 }
        );
      }
      const loaded = await loadWorkflowFromFileProject(body.projectId);
      loadedWorkflow = loaded.workflow;
      filePath = loaded.filePath;
      workflowState = {
        nodes: loadedWorkflow?.nodes ?? [],
        edges: loadedWorkflow?.edges ?? [],
      };
    }

    if (!workflowState || !Array.isArray(workflowState.nodes) || !Array.isArray(workflowState.edges)) {
      return NextResponse.json({ ok: false, error: "workflowState must include nodes[] and edges[] (or provide projectId)." }, { status: 400 });
    }

    if (!operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { ok: false, error: "operations must be an array" },
        { status: 400 }
      );
    }

    const result = applyEditOperations(operations as any, {
      nodes: workflowState.nodes,
      edges: workflowState.edges,
    });

    if (filePath && loadedWorkflow) {
      loadedWorkflow.nodes = result.nodes;
      loadedWorkflow.edges = result.edges;
      await saveWorkflowToFileProject(filePath, loadedWorkflow);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[Flowy apply] error:", err);
    return NextResponse.json({ ok: false, error: "Failed to apply operations" }, { status: 500 });
  }
}

