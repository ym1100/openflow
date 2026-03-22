"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkflowFile } from "@/store/workflowStore";
import { ProjectsStitchListPanel } from "@/components/projects/ProjectsStitchListPanel";
import { StitchProjectsHero } from "@/components/projects/StitchProjectsHero";
import type { ProjectsViewTab } from "@/components/projects/ProjectsStickyHeader";
import { NewProjectModal } from "@/components/NewProjectModal";
import { useWorkflowStore } from "@/store/workflowStore";
import { useToast } from "@/components/Toast";
import { createProject, updateProject } from "@/lib/local-db";
import { getDefaultProjectDirectory } from "@/store/utils/localStorage";
import { ensureProjectSubfolderPath } from "@/lib/project-directory-path";

export default function ProjectsPage() {
  const router = useRouter();
  const { show } = useToast();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ProjectsViewTab>("templates");
  const [pendingTemplateWorkflow, setPendingTemplateWorkflow] = useState<WorkflowFile | null>(null);
  const setWorkflowMetadata = useWorkflowStore(
    (state) => state.setWorkflowMetadata
  );
  const loadWorkflow = useWorkflowStore((state) => state.loadWorkflow);
  const setUseExternalImageStorage = useWorkflowStore(
    (state) => state.setUseExternalImageStorage
  );

  const openNewProjectModal = (workflow: WorkflowFile | null) => {
    setPendingTemplateWorkflow(workflow);
    setShowNewProjectModal(true);
  };

  const handleProjectSave = async (
    _id: string,
    name: string,
    fullProjectPath: string
  ) => {
    setShowNewProjectModal(false);
    const workflowThumbnail = useWorkflowStore.getState().workflowThumbnail;
    const workflowToSave = pendingTemplateWorkflow ?? {
      version: 1 as const,
      id: fullProjectPath,
      name,
      nodes: [],
      edges: [],
      edgeStyle: "angular" as const,
      groups: {},
    };
    const workflow = {
      ...workflowToSave,
      id: fullProjectPath,
      name,
      thumbnail: workflowThumbnail ?? workflowToSave.thumbnail ?? "/thumbnail.jpeg",
    };
    setPendingTemplateWorkflow(null);
    try {
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directoryPath: fullProjectPath,
          filename: name.replace(/[^a-zA-Z0-9-_]/g, "_"),
          workflow,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setWorkflowMetadata(fullProjectPath, name, fullProjectPath);
      await loadWorkflow(workflow, fullProjectPath);
      router.push(`/projects/${encodeURIComponent(fullProjectPath)}`);
    } catch (err) {
      console.error("Failed to create project:", err);
    }
  };

  const instantiateTemplateFromSidebar = useCallback(
    async (
      workflow: WorkflowFile,
      meta: { templateId: string; name: string; thumbnailUrl: string }
    ) => {
      const { name, thumbnailUrl } = meta;
      const workflowToSave: WorkflowFile = {
        ...workflow,
        name,
        thumbnail: thumbnailUrl,
      };
      const defaultDir = getDefaultProjectDirectory();

      try {
        if (defaultDir.trim()) {
          setUseExternalImageStorage(true);
          const fullProjectPath = ensureProjectSubfolderPath(defaultDir, name);
          const validateRes = await fetch(
            `/api/workflow?path=${encodeURIComponent(fullProjectPath)}`
          );
          const validateJson = (await validateRes.json()) as {
            exists?: boolean;
            isDirectory?: boolean;
          };
          if (validateJson.exists && !validateJson.isDirectory) {
            show("Project path is not a directory", "error");
            return;
          }

          const postRes = await fetch("/api/workflow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              directoryPath: fullProjectPath,
              filename: name.replace(/[^a-zA-Z0-9-_]/g, "_"),
              workflow: { ...workflowToSave, id: fullProjectPath },
            }),
          });
          const postData = (await postRes.json()) as { success?: boolean; error?: string };
          if (!postData.success) throw new Error(postData.error || "Failed to save project");

          setWorkflowMetadata(fullProjectPath, name, fullProjectPath);
          await loadWorkflow({ ...workflowToSave, id: fullProjectPath }, fullProjectPath);
          router.push(`/projects/${encodeURIComponent(fullProjectPath)}`);
        } else {
          const created = await createProject({
            name,
            image: thumbnailUrl,
          });
          await updateProject(created.id, {
            content: {
              ...workflowToSave,
              id: created.id,
              name,
              thumbnail: thumbnailUrl,
            },
          });
          await loadWorkflow({
            ...workflowToSave,
            id: created.id,
            name,
            thumbnail: thumbnailUrl,
          });
          router.push(`/projects/${encodeURIComponent(created.id)}`);
        }
        show("Project created", "success");
      } catch (err) {
        show(err instanceof Error ? err.message : "Failed to create project", "error");
      }
    },
    [loadWorkflow, router, setUseExternalImageStorage, setWorkflowMetadata, show]
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-black text-[13px] leading-[1.35] text-white antialiased [-webkit-font-smoothing:antialiased]">
      <NewProjectModal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
        onSave={handleProjectSave}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden bg-black">
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
          <Link
            href="/projects"
            className="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.06] sm:right-6 sm:top-5"
            title="Openflows"
          >
            <img src="/logo.png" alt="" className="size-7 object-contain opacity-95" />
          </Link>
          <ProjectsStitchListPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            onNewProject={() => openNewProjectModal(null)}
            onInstantiateTemplate={instantiateTemplateFromSidebar}
          />
          <main className="flowy-chat-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-black [scrollbar-width:thin]">
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-8 py-[15dvh] sm:px-10">
              <div className="flex w-full flex-1 flex-col items-center justify-center">
                <StitchProjectsHero
                  onWorkflowGenerated={(wf) => openNewProjectModal(wf)}
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
