import { applyEditOperations } from "@/lib/chat/editOperations";
import { NextResponse } from "next/server";
import { isFileProjectId, loadWorkflowFromFileProject, saveWorkflowToFileProject } from "@/lib/projectFileIO";
import { computeWorkflowHash } from "@/lib/flowy/workflowHash";

export const runtime = "nodejs";

const IDEMPOTENCY_CACHE_TTL_MS = 5 * 60 * 1000;
const applyIdempotencyCache = new Map<string, { at: number; payload: any }>();

function cleanupIdempotencyCache() {
  const now = Date.now();
  for (const [k, v] of applyIdempotencyCache.entries()) {
    if (now - v.at > IDEMPOTENCY_CACHE_TTL_MS) applyIdempotencyCache.delete(k);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      projectId?: string;
      workflowState?: {
        nodes: any[];
        edges: any[];
        groups?: Record<string, any>;
      };
      operations?: any[];
      idempotencyKey?: string;
      expectedWorkflowHash?: string;
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
        groups: loadedWorkflow?.groups ?? {},
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

    cleanupIdempotencyCache();
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const expectedWorkflowHash =
      typeof body.expectedWorkflowHash === "string" ? body.expectedWorkflowHash.trim() : "";
    const currentHash = computeWorkflowHash(workflowState);

    if (expectedWorkflowHash && expectedWorkflowHash !== currentHash) {
      return NextResponse.json(
        {
          ok: false,
          error: "workflow_version_conflict",
          expectedWorkflowHash,
          currentWorkflowHash: currentHash,
        },
        { status: 409 }
      );
    }

    const idemScope = body.projectId || "inline-workflow";
    const idemCacheKey = idempotencyKey ? `${idemScope}:${idempotencyKey}` : "";
    if (idemCacheKey && applyIdempotencyCache.has(idemCacheKey)) {
      const cached = applyIdempotencyCache.get(idemCacheKey)!;
      return NextResponse.json({ ...cached.payload, idempotentReplay: true });
    }

    const result = applyEditOperations(operations as any, {
      nodes: workflowState.nodes,
      edges: workflowState.edges,
      groups: workflowState.groups ?? {},
    });

    if (filePath && loadedWorkflow) {
      loadedWorkflow.nodes = result.nodes;
      loadedWorkflow.edges = result.edges;
      loadedWorkflow.groups = result.groups ?? {};
      await saveWorkflowToFileProject(filePath, loadedWorkflow);
    }

    const nextWorkflowHash = computeWorkflowHash({
      nodes: result.nodes,
      edges: result.edges,
      groups: result.groups,
    });

    const responsePayload = {
      ok: true,
      ...result,
      workflowHash: nextWorkflowHash,
      previousWorkflowHash: currentHash,
    };

    if (idemCacheKey) {
      applyIdempotencyCache.set(idemCacheKey, {
        at: Date.now(),
        payload: responsePayload,
      });
    }

    return NextResponse.json(responsePayload);
  } catch (err) {
    console.error("[Flowy apply] error:", err);
    return NextResponse.json({ ok: false, error: "Failed to apply operations" }, { status: 500 });
  }
}

