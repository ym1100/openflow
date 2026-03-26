"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { useWorkflowStore, saveNanoBananaDefaults } from "@/store/workflowStore";
import { splitWithDimensions } from "@/utils/gridSplitter";
import type {
  NanoBananaNodeData,
  AspectRatio,
  Resolution,
  ModelType,
  SelectedModel,
} from "@/types";
import { ProviderBadge } from "../shared/ProviderBadge";
import { loadNodeDefaults } from "@/store/utils/localStorage";
import { getProviderDisplayName } from "@/utils/providerUrls";
import { useToast } from "@/components/Toast";

// Local copies of the Gemini image model + ratio/resolution presets
const GEMINI_IMAGE_MODELS: { value: ModelType; label: string }[] = [
  { value: "nano-banana", label: "Nano Banana" },
  { value: "nano-banana-2", label: "Nano Banana 2" },
  { value: "nano-banana-pro", label: "Nano Banana Pro" },
];

const BASE_ASPECT_RATIOS: AspectRatio[] = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
];

const EXTENDED_ASPECT_RATIOS: AspectRatio[] = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
];

const RESOLUTIONS_PRO: Resolution[] = ["1K", "2K", "4K"];
const RESOLUTIONS_NB2: Resolution[] = ["512", "1K", "2K", "4K"];

interface GenerateImageToolbarProps {
  nodeId: string;
}

export function GenerateImageToolbar({ nodeId }: GenerateImageToolbarProps) {
  const node = useWorkflowStore((state) =>
    state.nodes.find((n) => n.id === nodeId),
  );
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const addNode = useWorkflowStore((state) => state.addNode);
  const addEdgeWithType = useWorkflowStore((state) => state.addEdgeWithType);
  const executeSelectedNodes = useWorkflowStore((state) => state.executeSelectedNodes);
  const nodes = useWorkflowStore((state) => state.nodes);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const data = node?.data as NanoBananaNodeData | undefined;
  const hasImage = !!data?.outputImage;
  const cropActive = !!data?.cropMode;

  const handleSplitIntoGrid = async (rows: number, cols: number) => {
    if (!hasImage || !data?.outputImage || !node) return;
    const sourceImage = data.outputImage;
    try {
      const { images } = await splitWithDimensions(sourceImage, rows, cols);
      if (!images || images.length === 0) return;

      const baseX =
        node.position.x +
        (typeof node.style?.width === "number" ? (node.style.width as number) : 300) +
        40;
      const baseY = node.position.y;
      const nodeWidth = 250;
      const nodeHeight = 220;
      const gap = 20;

      images.forEach((imageData, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;

        const newId = addNode(
          "mediaInput",
          {
            x: baseX + col * (nodeWidth + gap),
            y: baseY + row * (nodeHeight + gap),
          },
          {
            mode: "image",
            image: imageData,
            filename: `grid-${rows}x${cols}-${row + 1}-${col + 1}.png`,
          }
        );

        addEdgeWithType(
          {
            source: nodeId,
            target: newId,
            sourceHandle: "image",
            targetHandle: "reference",
          },
          "reference"
        );
      });
    } catch {
      // ignore split errors
    }
  };

  useEffect(() => {
    if (!toolsOpen && !modelMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (toolsRef.current?.contains(target)) return;
      if (modelMenuRef.current?.contains(target)) return;
      setToolsOpen(false);
      setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [toolsOpen, modelMenuOpen]);

  // Default image models from settings (same source as ControlPanel)
  const { defaultImageModels, defaultModelIndex } = useMemo(() => {
    const cfg = loadNodeDefaults();
    const d = cfg.generateImage;
    const models = d?.selectedModels ?? (d?.selectedModel ? [d.selectedModel] : []);
    const idx = Math.min(d?.defaultModelIndex ?? 0, Math.max(0, models.length - 1));
    return { defaultImageModels: models, defaultModelIndex: idx };
  }, []);

  const { defaultUpscaleModels, defaultUpscaleModelIndex } = useMemo(() => {
    const cfg = loadNodeDefaults();
    const d = cfg.generateImageUpscale;
    const models =
      d?.selectedModels?.length
        ? d.selectedModels
        : d?.selectedModel
          ? [d.selectedModel]
          : [];
    const idx = Math.min(d?.defaultModelIndex ?? 0, Math.max(0, models.length - 1));
    return { defaultUpscaleModels: models, defaultUpscaleModelIndex: idx };
  }, []);

  const {
    provider,
    modelId,
    modelLabel,
    aspectRatios,
    supportsResolution,
    resolutions,
  } = useMemo(() => {
    if (!data) {
      return {
        provider: "gemini" as const,
        modelId: undefined as ModelType | undefined,
        modelLabel: "Select model",
        aspectRatios: BASE_ASPECT_RATIOS,
        supportsResolution: false,
        resolutions: RESOLUTIONS_PRO,
      };
    }

    const currentProvider = data.selectedModel?.provider ?? "gemini";
    const currentModelId =
      (currentProvider === "gemini"
        ? data.selectedModel?.modelId || data.model
        : undefined) ?? ("nano-banana-pro" as ModelType);

    const label =
      data.selectedModel?.displayName ??
      data.selectedModel?.modelId ??
      data.model ??
      "Select model";

    const isNb2 = currentModelId === "nano-banana-2";
    const isPro =
      currentModelId === "nano-banana-pro" || currentModelId === "nano-banana-2";

    return {
      provider: currentProvider,
      modelId: currentModelId,
      modelLabel: label,
      aspectRatios: isNb2 ? EXTENDED_ASPECT_RATIOS : BASE_ASPECT_RATIOS,
      supportsResolution: isPro,
      resolutions: isNb2 ? RESOLUTIONS_NB2 : RESOLUTIONS_PRO,
    };
  }, [data]);

  if (!node || !data) return null;

  const handleCropToggle = () => {
    updateNodeData(nodeId, { cropMode: !cropActive });
  };

  const handleUpscaleImage = async () => {
    if (!hasImage || !data.outputImage) return;
    const selectedModel = defaultUpscaleModels[defaultUpscaleModelIndex] ?? null;
    if (!selectedModel) {
      useToast.getState().show("Set Default Image Upscale Models in Node Defaults first", "error");
      return;
    }
    const baseX =
      node.position.x +
      (typeof node.style?.width === "number" ? (node.style.width as number) : 300) +
      80;
    const baseY = node.position.y;

    const newId = addNode(
      "generateImage",
      { x: baseX, y: baseY },
      {
        customTitle: "Upscale",
        inputImages: [data.outputImage],
        inputPrompt: "Upscale this image and preserve details.",
        selectedModel,
      }
    );

    addEdgeWithType(
      {
        source: nodeId,
        target: newId,
        sourceHandle: "image",
        targetHandle: "image",
      },
      "image"
    );

    setToolsOpen(false);
    useToast.getState().show("Upscale node added", "success");
    try {
      await executeSelectedNodes([newId]);
    } catch {
      useToast.getState().show("Upscale run failed to start", "error");
    }
  };

  const stopProp = (e: React.MouseEvent | React.PointerEvent) =>
    e.stopPropagation();


  const handleAspectRatioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const aspectRatio = e.target.value as AspectRatio;
    updateNodeData(nodeId, { aspectRatio });
    saveNanoBananaDefaults({ aspectRatio });
  };

  const handleResolutionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const resolution = e.target.value as Resolution;
    updateNodeData(nodeId, { resolution });
    saveNanoBananaDefaults({ resolution });
  };

  const handleDefaultModelSelectByIndex = (idx: number) => {
    if (!defaultImageModels[idx]) return;
    const m = defaultImageModels[idx];
    updateNodeData(nodeId, {
      selectedModel: {
        provider: m.provider,
        modelId: m.modelId,
        displayName: m.displayName,
      },
      parameters: {},
    });
    setModelMenuOpen(false);
  };

  const handleGeminiModelSelect = (nextModel: ModelType) => {
    updateNodeData(nodeId, { model: nextModel });
    saveNanoBananaDefaults({ model: nextModel });
    const newSelectedModel: SelectedModel = {
      provider: "gemini",
      modelId: nextModel,
      displayName:
        GEMINI_IMAGE_MODELS.find((m) => m.value === nextModel)?.label ||
        nextModel,
    };
    updateNodeData(nodeId, { selectedModel: newSelectedModel });
    setModelMenuOpen(false);
  };

  const handleUseDefault = () => {
    const m = defaultImageModels[defaultModelIndex];
    if (!m) return;
    updateNodeData(nodeId, {
      selectedModel: {
        provider: m.provider,
        modelId: m.modelId,
        displayName: m.displayName,
      },
      parameters: {},
    });
  };

  const currentDefaultIndex =
    data.selectedModel && defaultImageModels.length > 0
      ? (() => {
          const idx = defaultImageModels.findIndex(
            (m: any) =>
              m.provider === data.selectedModel?.provider &&
              m.modelId === data.selectedModel?.modelId,
          );
          return idx >= 0 ? String(idx) : "";
        })()
      : "";

  return (
    <NodeToolbar
      nodeId={nodeId}
      position={Position.Top}
      offset={8}
      align="center"
      className="nodrag nopan"
      style={{ pointerEvents: "auto" }}
    >
      <div
        className="overflow-visible"
        onMouseDownCapture={stopProp}
        onPointerDownCapture={stopProp}
      >
        <div className="flex items-center gap-1 rounded-xl border border-neutral-600 bg-neutral-800/95 px-2 py-1 shadow-lg backdrop-blur-sm text-[11px]">
          {/* Provider + model (defaults from settings, including external like Flux 2) */}
          <div className="flex items-center gap-1 max-w-[180px]">
            <ProviderBadge provider={provider} />
            {defaultImageModels.length > 0 || provider === "gemini" ? (
              <div ref={modelMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setModelMenuOpen((open) => !open)}
                  className="nodrag nopan inline-flex max-w-[140px] items-center gap-1 rounded-lg px-1.5 py-0.5 text-left text-neutral-100 hover:bg-white/5"
                  title={
                    data.selectedModel?.displayName ||
                    modelLabel ||
                    "Select model"
                  }
                >
                  <span className="truncate">
                    {data.selectedModel?.displayName || modelLabel || "Select model"}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 text-neutral-400 transition-transform ${modelMenuOpen ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {modelMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 flex min-w-52 flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900/95 p-1 text-[11px] text-neutral-100 shadow-xl backdrop-blur-lg">
                    {defaultImageModels.length > 0
                      ? defaultImageModels.map((m: any, i: number) => {
                          const isActive = String(i) === currentDefaultIndex;
                          return (
                            <button
                              key={`${m.provider}-${m.modelId}-${i}`}
                              type="button"
                              onClick={() => handleDefaultModelSelectByIndex(i)}
                              className={`relative flex h-10 cursor-pointer select-none items-center rounded-xl p-2 text-left outline-none ${isActive ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <span className="truncate">
                                {getProviderDisplayName(m.provider)}: {m.displayName}
                              </span>
                            </button>
                          );
                        })
                      : GEMINI_IMAGE_MODELS.map((m) => {
                          const isActive = (modelId ?? "nano-banana-pro") === m.value;
                          return (
                            <button
                              key={m.value}
                              type="button"
                              onClick={() => handleGeminiModelSelect(m.value)}
                              className={`relative flex h-10 cursor-pointer select-none items-center rounded-xl p-2 text-left outline-none ${isActive ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <span className="truncate">{m.label}</span>
                            </button>
                          );
                        })}
                  </div>
                )}
              </div>
            ) : (
              <span className="truncate text-neutral-100">{modelLabel}</span>
            )}
          </div>

          {defaultImageModels.length > 0 && (
            <button
              type="button"
              onClick={handleUseDefault}
              className="nodrag nopan ml-1 rounded-full bg-neutral-700/80 px-1.5 py-0.5 text-[9px] text-neutral-200 hover:bg-neutral-600"
              title="Use default image model"
            >
              Default
            </button>
          )}

          {/* Aspect ratio + resolution (Gemini only) */}
          {provider === "gemini" && (
            <>
              <div className="h-4 w-px bg-neutral-600" />
              <div className="flex items-center gap-1 text-neutral-300">
                <select
                  data-id="generate-image-toolbar-aspect-ratio"
                  data-openflow-node-id={nodeId}
                  value={data.aspectRatio || "1:1"}
                  onChange={handleAspectRatioChange}
                  className="nodrag nopan bg-neutral-700/80 text-[10px] rounded-full px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-neutral-500"
                  title="Aspect ratio"
                >
                  {aspectRatios.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
                {supportsResolution && (
                  <select
                    value={data.resolution || "2K"}
                    onChange={handleResolutionChange}
                    className="nodrag nopan bg-neutral-700/80 text-[10px] rounded-full px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-neutral-500"
                    title="Resolution"
                  >
                    {resolutions.map((res) => (
                      <option key={res} value={res}>
                        {res}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}

          {/* Divider before tools */}
          <div className="h-4 w-px bg-neutral-600 ml-1" />

          {/* Direct tools + overflow menu */}
          <div ref={toolsRef} className="relative flex items-center gap-x-px">
            <button
              type="button"
              onClick={handleCropToggle}
              disabled={!hasImage}
              className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-50 ${
                cropActive ? "text-white bg-white/10" : "text-neutral-300"
              }`}
              title="Crop"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>
            </button>
            <button type="button" disabled className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5 disabled:opacity-50" title="3D Camera Angle">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7.5 12 2.25 3 7.5m18 0-9 5.25m9-5.25v9L12 21.75m0-9L3 7.5m9 5.25v9M3 7.5v9l9 5.25" /></svg>
            </button>
            <button type="button" onClick={() => { void handleUpscaleImage(); }} disabled={!hasImage} className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5 disabled:opacity-50" title="Upscale">
              <svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" width="14" height="14" className="text-neutral-200">
                <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1H8a.5.5 0 0 1 0 1H3.5a.5.5 0 0 0-.5.5V7a.5.5 0 0 1-1 0V2.5Z" fill="currentColor" />
                <path d="M11 7a.5.5 0 0 1 .5.5V11a1.5 1.5 0 0 1-1.5 1.5H6.5a.5.5 0 0 1 0-1H10a.5.5 0 0 0 .5-.5V7.5A.5.5 0 0 1 11 7Z" fill="currentColor" />
                <path d="M9.5 2H12a.5.5 0 0 1 .354.854l-3 3a.5.5 0 0 1-.708-.708L10.293 3H9.5a.5.5 0 0 1 0-1Z" fill="currentColor" />
              </svg>
            </button>
            <button type="button" disabled className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5 disabled:opacity-50" title="Inpaint">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 4V2" /><path d="M15 10V8" /><path d="M19 6h2" /><path d="M13 6h-2" /><path d="m17.5 8.5 1.5 1.5" /><path d="M13.5 4.5 12 3" /><path d="m11 11-8 8" /><path d="m3 11 8 8" />
              </svg>
            </button>
            <button type="button" disabled className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5 disabled:opacity-50" title="Outpaint">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h7v7H3z" /><path d="M14 14h7v7h-7z" /><path d="M14 3h7v7h-7z" /><path d="M3 14h7v7H3z" /></svg>
            </button>
            <button type="button" onClick={() => hasImage && setToolsOpen((open) => !open)} disabled={!hasImage} className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5 disabled:opacity-50" title="More tools">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
            {toolsOpen && hasImage && (
              <div className="absolute left-0 top-full mt-1 z-50 flex min-w-52 flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900/95 p-1 text-[11px] text-neutral-100 shadow-xl backdrop-blur-lg">
                <button type="button" disabled className="relative flex h-9 items-center rounded-xl p-2 opacity-60 cursor-not-allowed"><span className="flex-1">Remove background</span></button>
                <div role="group" className="relative flex h-9 select-none items-center rounded-xl p-2">
                  <span className="flex-1">Split into layers</span>
                  <div className="ml-2 shrink-0 flex">{[2, 3, 4, 5].map((n) => <button key={n} type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[10px] text-neutral-300 hover:bg-white/5 hover:text-white">{n}</button>)}</div>
                </div>
                <div role="group" className="relative flex h-9 select-none items-center rounded-xl p-2">
                  <span className="flex-1">Split into grid</span>
                  <div className="ml-2 shrink-0 flex">
                    {[{ label: "2×2", rows: 2, cols: 2 }, { label: "3×3", rows: 3, cols: 3 }, { label: "4×4", rows: 4, cols: 4 }].map((option) => (
                      <button key={option.label} type="button" onClick={(e) => { e.stopPropagation(); handleSplitIntoGrid(option.rows, option.cols); }} className="inline-flex h-6 rounded-lg px-1 text-[10px] text-neutral-300 hover:bg-white/5 hover:text-white">{option.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mx-1 h-4 w-px bg-neutral-600" />
          <button
            type="button"
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5"
            title="Save node"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3v4a1 1 0 0 0 1 1h8" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l3 3v13a2 2 0 0 1-2 2Z" />
              <path d="M10 17h4" />
            </svg>
          </button>
          <button
            type="button"
            disabled={!hasImage}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-300 hover:bg-white/5 disabled:opacity-50 disabled:cursor-default"
            title="Fullscreen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </div>
    </NodeToolbar>
  );
}

