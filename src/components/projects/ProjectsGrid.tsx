"use client";

import { useEffect, useState, useMemo } from "react";
import type { LocalProject } from "@/lib/local-db";
import type { FileProject } from "@/lib/project-types";
import { ProjectCard } from "./ProjectCard";
import { deleteProject } from "@/lib/local-db";
import { listProjects } from "@/lib/local-db";
import { getDefaultProjectDirectory } from "@/store/utils/localStorage";
import { useToast } from "@/components/Toast";
import { FolderPlus, LayoutGrid, List } from "lucide-react";

type ProjectItem = LocalProject | FileProject;
type OrganizerFolder = {
  id: string;
  name: string;
  createdAt: string;
};
type OrganizerState = {
  folders: OrganizerFolder[];
  assignments: Record<string, string>;
};
const ORGANIZER_STORAGE_KEY = "openflow-project-organizer-v1";

export function ProjectsGrid({ searchQuery = "" }: { searchQuery?: string }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [useFileSystem, setUseFileSystem] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [organizerFolders, setOrganizerFolders] = useState<OrganizerFolder[]>([]);
  const [projectFolderAssignments, setProjectFolderAssignments] = useState<Record<string, string>>({});
  const [activeFolderFilter, setActiveFolderFilter] = useState<string>("all");
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [movingProjectId, setMovingProjectId] = useState<string | null>(null);
  const [organizerLoaded, setOrganizerLoaded] = useState(false);
  const { show } = useToast();

  const load = async (pathOverride?: string) => {
    setLoading(true);
    try {
      const defaultDir = getDefaultProjectDirectory();
      if (defaultDir.trim()) {
        setUseFileSystem(true);
        const activePath = pathOverride ?? (currentPath || defaultDir);
        const res = await fetch(
          `/api/projects/list?path=${encodeURIComponent(activePath)}`
        );
        const data = await res.json();
        if (data.success) {
          const resolvedPath = data.basePath ?? activePath;
          setCurrentPath(resolvedPath);
          if (Array.isArray(data.projects)) {
            setProjects(
              data.projects.map((p: { id: string; name: string; path: string; updatedAt: string; thumbnail?: string }) => ({
                id: p.id,
                name: p.name,
                path: p.path,
                updatedAt: p.updatedAt,
                source: "file" as const,
                thumbnail: p.thumbnail ?? "/thumbnail.jpeg",
              }))
            );
          } else {
            setProjects([]);
          }

          // Load organizer metadata from workspace path JSON first.
          try {
            const organizerRes = await fetch(
              `/api/projects/organizer?path=${encodeURIComponent(resolvedPath)}`
            );
            const organizerData = await organizerRes.json();
            if (organizerData?.success && organizerData?.state) {
              const state = organizerData.state as OrganizerState;
              setOrganizerFolders(Array.isArray(state.folders) ? state.folders : []);
              setProjectFolderAssignments(
                state.assignments && typeof state.assignments === "object"
                  ? state.assignments
                  : {}
              );
              localStorage.setItem(
                ORGANIZER_STORAGE_KEY,
                JSON.stringify({
                  folders: Array.isArray(state.folders) ? state.folders : [],
                  assignments:
                    state.assignments && typeof state.assignments === "object"
                      ? state.assignments
                      : {},
                })
              );
            }
          } catch {
            // keep local fallback state
          }
        } else {
          setProjects([]);
        }
      } else {
        setUseFileSystem(false);
        const local = await listProjects();
        setProjects(local);
      }
    } catch (error) {
      console.error("Error loading projects:", error);
      show("Failed to load projects", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        await load();
      } catch {
        // no-op, toast already shown by loader
      }
    };
    init();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORGANIZER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as OrganizerState;
      if (Array.isArray(parsed.folders)) setOrganizerFolders(parsed.folders);
      if (parsed.assignments && typeof parsed.assignments === "object") {
        setProjectFolderAssignments(parsed.assignments);
      }
    } catch {
      // ignore corrupt organizer state
    } finally {
      setOrganizerLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!organizerLoaded) return;
    const state: OrganizerState = {
      folders: organizerFolders,
      assignments: projectFolderAssignments,
    };
    localStorage.setItem(ORGANIZER_STORAGE_KEY, JSON.stringify(state));
    if (!useFileSystem || !currentPath) return;
    void fetch("/api/projects/organizer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath, state }),
    });
  }, [organizerFolders, projectFolderAssignments, organizerLoaded, useFileSystem, currentPath]);

  const visibleProjects = useMemo(() => {
    if (activeFolderFilter === "all") return projects;
    if (activeFolderFilter === "unassigned") {
      return projects.filter((p) => !projectFolderAssignments[p.id]);
    }
    return projects.filter((p) => projectFolderAssignments[p.id] === activeFolderFilter);
  }, [projects, projectFolderAssignments, activeFolderFilter]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return visibleProjects;
    const q = searchQuery.toLowerCase().trim();
    return visibleProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [visibleProjects, searchQuery]);
  const filteredOrganizerFolders = useMemo(() => {
    if (activeFolderFilter !== "all") return [];
    if (!searchQuery.trim()) return organizerFolders;
    const q = searchQuery.toLowerCase().trim();
    return organizerFolders.filter((f) => f.name.toLowerCase().includes(q));
  }, [organizerFolders, searchQuery, activeFolderFilter]);

  const handleDelete = async (project: ProjectItem) => {
    try {
      const isFile = "source" in project && project.source === "file";
      if (isFile && "path" in project) {
        const res = await fetch(
          `/api/projects/delete?path=${encodeURIComponent(project.path)}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
      } else {
        await deleteProject(project.id);
      }
      setProjects((prev) =>
        prev.filter((p) =>
          isFile
            ? !("path" in p) || p.path !== (project as FileProject).path
            : p.id !== project.id
        )
      );
      show("Project deleted successfully", "success");
      setSelectedProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
      setProjectFolderAssignments((prev) => {
        if (!prev[project.id]) return prev;
        const next = { ...prev };
        delete next[project.id];
        return next;
      });
    } catch (error) {
      show(
        error instanceof Error ? error.message : "Failed to delete project",
        "error"
      );
    }
  };

  const handleRename = async (pathValue: string, currentName: string) => {
    try {
      const nextName = window.prompt("Rename item", currentName)?.trim();
      if (!nextName || nextName === currentName) return;
      const res = await fetch("/api/projects/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathValue, newName: nextName }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to rename");
      show("Renamed successfully", "success");
      await load(currentPath);
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to rename", "error");
    }
  };

  const handleMoveProject = (folderId: string | null) => {
    if (!movingProjectId) return;
    setProjectFolderAssignments((prev) => {
      const next = { ...prev };
      if (!folderId) delete next[movingProjectId];
      else next[movingProjectId] = folderId;
      return next;
    });
    show(folderId ? "Project moved to organizer folder" : "Project removed from folder", "success");
    setShowMoveModal(false);
    setMovingProjectId(null);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      show("Please enter a folder name", "error");
      return;
    }
    const alreadyExists = organizerFolders.some((f) => f.name.toLowerCase() === name.toLowerCase());
    if (alreadyExists) {
      show("Folder name already exists", "error");
      return;
    }
    setOrganizerFolders((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() },
    ]);
    show("Organizer folder created", "success");
    setShowCreateFolderModal(false);
    setNewFolderName("");
  };

  const toggleSelectProject = (id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4 w-full">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="aspect-tv rounded-md bg-[#1c1c1c] animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {useFileSystem && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            {activeFolderFilter === "all" ? (
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-white">
                All projects
              </span>
            ) : activeFolderFilter === "unassigned" ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveFolderFilter("all")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-neutral-200 hover:bg-white/10"
                >
                  Back
                </button>
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-white">
                  No folder
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setActiveFolderFilter("all")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-neutral-200 hover:bg-white/10"
                >
                  Back
                </button>
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-white">
                  {organizerFolders.find((f) => f.id === activeFolderFilter)?.name ?? "Folder"}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`rounded-md p-1.5 ${viewMode === "grid" ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/5"}`}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-md p-1.5 ${viewMode === "list" ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/5"}`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateFolderModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
            >
              <FolderPlus className="h-4 w-4" />
              New folder
            </button>
          </div>
        </div>
      )}

      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#171717] p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Create folder</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Enter a folder name to organize your projects.
            </p>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateFolder();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setShowCreateFolderModal(false);
                  setNewFolderName("");
                }
              }}
              placeholder="Folder name"
              className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreateFolderModal(false);
                  setNewFolderName("");
                }}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-neutral-200 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateFolder()}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#171717] p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Move to folder</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Choose an organizer folder (metadata only).
            </p>
            <div className="mt-3 max-h-64 space-y-1 overflow-auto rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => handleMoveProject(null)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-white hover:bg-white/10"
              >
                <span className="truncate">No folder</span>
                <span className="text-xs text-neutral-400">Unassigned</span>
              </button>
              {organizerFolders.length === 0 ? (
                <div className="px-2 py-3 text-sm text-neutral-400">No folders available</div>
              ) : (
                organizerFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => handleMoveProject(folder.id)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-white hover:bg-white/10"
                  >
                    <span className="truncate">{folder.name}</span>
                    <span className="text-xs text-neutral-400">Folder</span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowMoveModal(false);
                  setMovingProjectId(null);
                }}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-neutral-200 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4 w-full">
          {filteredOrganizerFolders.map((folder) => {
            const count = projects.filter((p) => projectFolderAssignments[p.id] === folder.id).length;
            const previewProjects = projects
              .filter((p) => projectFolderAssignments[p.id] === folder.id)
              .sort(
                (a, b) =>
                  new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
              )
              .slice(0, 3);
            return (
              <div key={folder.id} className="w-full h-fit">
                <button
                  type="button"
                  onClick={() => setActiveFolderFilter(folder.id)}
                  className="w-full h-fit text-left"
                >
                  <div className="relative group/menu outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0">
                    <div className="overflow-hidden relative cursor-pointer isolate rounded-2xl p-2 pb-2 transition-all duration-200 bg-[#1F1F1F] outline outline-white/[0.08] -outline-offset-1 hover:bg-[#232323]">
                      <div
                        className="relative w-full overflow-hidden rounded-xl"
                        style={{
                          aspectRatio: "4 / 3",
                          background:
                            "linear-gradient(136deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%), rgb(29, 36, 42)",
                        }}
                      >
                        <div className="absolute inset-0" style={{ perspective: "400px" }}>
                          <div
                            className="absolute"
                            style={{
                              width: "37.3%",
                              transformOrigin: "left top",
                              left: "58.5%",
                              top: "24.6%",
                              zIndex: 3,
                              transform: "rotate(15deg)",
                            }}
                          >
                            <div className="w-full rounded-xl shadow-[-2px_-1px_10.5px_rgba(0,0,0,0.4)] outline outline-1 outline-[#CCCCCC]/50 relative bg-gradient-to-b from-[#CCCECE] to-[#939E9E] overflow-hidden" style={{ aspectRatio: "100 / 134" }}>
                              {previewProjects[0] && "thumbnail" in previewProjects[0] && previewProjects[0].thumbnail ? (
                                <img
                                  src={previewProjects[0].thumbnail}
                                  alt="Collection preview"
                                  className="w-full h-full object-cover transition-opacity duration-200"
                                />
                              ) : null}
                            </div>
                          </div>
                          <div
                            className="absolute"
                            style={{
                              width: "37.3%",
                              transformOrigin: "left top",
                              left: "31.3%",
                              top: "18.5%",
                              zIndex: 2,
                            }}
                          >
                            <div className="w-full rounded-xl shadow-[-2px_-1px_10.5px_rgba(0,0,0,0.4)] outline outline-1 outline-[#CCCCCC]/50 relative bg-gradient-to-b from-[#CCCECE] to-[#939E9E] overflow-hidden" style={{ aspectRatio: "100 / 134" }}>
                              {previewProjects[1] && "thumbnail" in previewProjects[1] && previewProjects[1].thumbnail ? (
                                <img
                                  src={previewProjects[1].thumbnail}
                                  alt="Collection preview"
                                  className="w-full h-full object-cover transition-opacity duration-200"
                                />
                              ) : null}
                            </div>
                          </div>
                          <div
                            className="absolute"
                            style={{
                              width: "37.3%",
                              transformOrigin: "left top",
                              left: "5.6%",
                              top: "37.9%",
                              zIndex: 1,
                              transform: "rotate(-15deg)",
                            }}
                          >
                            <div className="w-full rounded-xl shadow-[-2px_-1px_10.5px_rgba(0,0,0,0.4)] outline outline-1 outline-[#CCCCCC]/50 relative bg-gradient-to-b from-[#CCCECE] to-[#939E9E] overflow-hidden" style={{ aspectRatio: "100 / 134" }}>
                              {previewProjects[2] && "thumbnail" in previewProjects[2] && previewProjects[2].thumbnail ? (
                                <img
                                  src={previewProjects[2].thumbnail}
                                  alt="Collection preview"
                                  className="w-full h-full object-cover transition-opacity duration-200"
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="absolute left-4 right-4 bottom-2 z-20">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-semibold truncate text-white transition-colors">
                              {folder.name}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Organizer folder</span>
                            <span className="text-[10px]">{count} Projets</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
          {filteredProjects.map((project) => (
            <ProjectCard
              key={"path" in project ? project.path : project.id}
              project={project}
              onDelete={() => handleDelete(project)}
              onRename={
                "path" in project ? () => handleRename(project.path, project.name) : undefined
              }
              onMove={
                "path" in project
                  ? () => {
                      setMovingProjectId(project.id);
                      setShowMoveModal(true);
                    }
                  : undefined
              }
              onToggleSelect={() => toggleSelectProject(project.id)}
              isSelected={selectedProjectIds.has(project.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5">
          {filteredOrganizerFolders.map((folder) => {
            const count = projects.filter((p) => projectFolderAssignments[p.id] === folder.id).length;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setActiveFolderFilter(folder.id)}
                className="flex w-full items-center justify-between border-b border-white/10 px-4 py-3 text-left hover:bg-white/5"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">{folder.name}</span>
                  <span className="text-xs text-neutral-400">Organizer folder</span>
                </div>
                <span className="text-xs text-neutral-400">{count} Projets</span>
              </button>
            );
          })}
          {filteredProjects.map((project) => (
            <div key={"path" in project ? project.path : project.id} className="border-b border-white/10 last:border-b-0">
              <ProjectCard
                project={project}
                onDelete={() => handleDelete(project)}
                onRename={"path" in project ? () => handleRename(project.path, project.name) : undefined}
                onMove={
                  "path" in project
                    ? () => {
                        setMovingProjectId(project.id);
                        setShowMoveModal(true);
                      }
                    : undefined
                }
                onToggleSelect={() => toggleSelectProject(project.id)}
                isSelected={selectedProjectIds.has(project.id)}
                compact
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
