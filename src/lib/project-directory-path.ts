/** Shared helpers for resolving new project folder paths (modal + instant template create). */

export function sanitizeProjectFolderName(projectName: string): string {
  return projectName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
}

export function joinPathForPlatform(basePath: string, folderName: string): string {
  const trimmedBase = basePath.trim();
  const separator = /^[A-Za-z]:[\\/]/.test(trimmedBase) || trimmedBase.startsWith("\\\\") ? "\\" : "/";
  const endsWithSeparator = trimmedBase.endsWith("/") || trimmedBase.endsWith("\\");
  return `${trimmedBase}${endsWithSeparator ? "" : separator}${folderName}`;
}

export function getPathBasename(fullPath: string): string {
  const withoutTrailingSeparator = fullPath.trim().replace(/[\\/]+$/, "");
  const parts = withoutTrailingSeparator.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

export function ensureProjectSubfolderPath(basePath: string, projectName: string): string {
  const trimmedBase = basePath.trim();
  const sanitizedFolder = sanitizeProjectFolderName(projectName);
  if (!sanitizedFolder) return trimmedBase;

  const basename = getPathBasename(trimmedBase);
  if (basename.toLowerCase() === sanitizedFolder.toLowerCase()) {
    return trimmedBase;
  }

  return joinPathForPlatform(trimmedBase, sanitizedFolder);
}
