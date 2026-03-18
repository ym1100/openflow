import { NextResponse } from "next/server";
import { loadWorkflowFromFileProject, isFileProjectId } from "@/lib/projectFileIO";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "";

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
    }

    if (!isFileProjectId(projectId)) {
      return NextResponse.json(
        { ok: false, error: "Server-side canvas state is only supported for file-backed projects (path-like projectIds)." },
        { status: 400 }
      );
    }

    const loaded = await loadWorkflowFromFileProject(projectId);
    const workflow = loaded.workflow;

    return NextResponse.json({
      ok: true,
      projectId: loaded.directoryPath,
      workflowState: {
        nodes: workflow?.nodes ?? [],
        edges: workflow?.edges ?? [],
        groups: workflow?.groups,
        edgeStyle: workflow?.edgeStyle,
      },
      directoryPath: loaded.directoryPath,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load canvas state" },
      { status: 500 }
    );
  }
}

