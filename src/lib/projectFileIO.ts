import fs from "fs/promises";
import path from "path";
import { validateWorkflowPath } from "@/utils/pathValidation";

export function isFileProjectId(id: string): boolean {
  try {
    const decoded = decodeURIComponent(id);
    return decoded.includes("\\") || decoded.includes("/") || /^[A-Za-z]:/.test(decoded);
  } catch {
    return false;
  }
}

async function loadFirstJsonFileInDir(dirPath: string): Promise<{ filePath: string; workflow: any }> {
  const files = await fs.readdir(dirPath);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(dirPath, file);
    const content = await fs.readFile(filePath, "utf-8");
    const workflow = JSON.parse(content);
    return { filePath, workflow };
  }
  throw new Error(`No .json workflow file found in directory: ${dirPath}`);
}

export async function loadWorkflowFromFileProject(projectId: string): Promise<{
  directoryPath: string;
  filePath: string;
  workflow: any;
}> {
  const decoded = decodeURIComponent(projectId);
  const pathValidation = validateWorkflowPath(decoded);
  if (!pathValidation.valid) throw new Error(pathValidation.error || "Invalid project path");

  const stats = await fs.stat(pathValidation.resolved);
  if (!stats.isDirectory()) throw new Error("Path is not a directory");

  const { filePath, workflow } = await loadFirstJsonFileInDir(pathValidation.resolved);
  return {
    directoryPath: pathValidation.resolved,
    filePath,
    workflow: {
      ...workflow,
      id: workflow?.id ?? pathValidation.resolved,
      directoryPath: workflow?.directoryPath ?? pathValidation.resolved,
    },
  };
}

export async function saveWorkflowToFileProject(filePath: string, workflow: any): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(workflow, null, 2), "utf-8");
}

