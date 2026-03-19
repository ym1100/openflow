import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { validateWorkflowPath } from "@/utils/pathValidation";

const ORGANIZER_FILENAME = ".openflow-organizer.json";

type OrganizerFolder = {
  id: string;
  name: string;
  createdAt: string;
};

type OrganizerState = {
  folders: OrganizerFolder[];
  assignments: Record<string, string>;
};

function sanitizeState(input: unknown): OrganizerState {
  if (!input || typeof input !== "object") {
    return { folders: [], assignments: {} };
  }
  const raw = input as Partial<OrganizerState>;
  const folders = Array.isArray(raw.folders)
    ? raw.folders
        .filter((f): f is OrganizerFolder => !!f && typeof f === "object")
        .map((f) => ({
          id: typeof f.id === "string" ? f.id : "",
          name: typeof f.name === "string" ? f.name : "",
          createdAt: typeof f.createdAt === "string" ? f.createdAt : new Date().toISOString(),
        }))
        .filter((f) => f.id && f.name)
    : [];
  const assignments =
    raw.assignments && typeof raw.assignments === "object"
      ? Object.fromEntries(
          Object.entries(raw.assignments).filter(
            ([k, v]) => typeof k === "string" && typeof v === "string"
          )
        )
      : {};
  return { folders, assignments };
}

export async function GET(request: NextRequest) {
  const basePath = request.nextUrl.searchParams.get("path");
  if (!basePath) {
    return NextResponse.json(
      { success: false, error: "Path parameter required" },
      { status: 400 }
    );
  }

  const validated = validateWorkflowPath(basePath);
  if (!validated.valid) {
    return NextResponse.json(
      { success: false, error: validated.error },
      { status: 400 }
    );
  }

  try {
    const metadataPath = path.join(validated.resolved, ORGANIZER_FILENAME);
    const content = await fs.readFile(metadataPath, "utf-8");
    const parsed = JSON.parse(content);
    return NextResponse.json({ success: true, state: sanitizeState(parsed) });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return NextResponse.json({
        success: true,
        state: { folders: [], assignments: {} },
      });
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load organizer metadata",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { path?: string; state?: unknown };
    const basePath = body.path;
    if (!basePath) {
      return NextResponse.json(
        { success: false, error: "path is required" },
        { status: 400 }
      );
    }

    const validated = validateWorkflowPath(basePath);
    if (!validated.valid) {
      return NextResponse.json(
        { success: false, error: validated.error },
        { status: 400 }
      );
    }

    const state = sanitizeState(body.state);
    const metadataPath = path.join(validated.resolved, ORGANIZER_FILENAME);
    await fs.writeFile(metadataPath, JSON.stringify(state, null, 2), "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to save organizer metadata",
      },
      { status: 500 }
    );
  }
}
