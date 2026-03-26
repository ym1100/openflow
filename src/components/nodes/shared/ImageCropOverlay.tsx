"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CropRect = { x: number; y: number; w: number; h: number };
type CropRatio = "free" | "1:1" | "4:3" | "3:2" | "16:9" | "9:16";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): CropRect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function ratioToNumber(r: CropRatio): number | null {
  if (r === "free") return null;
  const [w, h] = r.split(":").map((v) => Number(v));
  if (!w || !h) return null;
  return w / h;
}

function constrainPointToRatio(
  start: { x: number; y: number },
  now: { x: number; y: number },
  ratio: number,
): { x: number; y: number } {
  const dx = now.x - start.x;
  const dy = now.y - start.y;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx === 0 && ady === 0) return now;

  // Choose which axis "drives" the constraint based on which changed more.
  // ratio = w / h  =>  h = w / ratio  and w = h * ratio
  const widthDriven = adx / Math.max(1, ady) >= ratio;
  if (widthDriven) {
    const w = adx;
    const h = w / ratio;
    return { x: start.x + sx * w, y: start.y + sy * h };
  } else {
    const h = ady;
    const w = h * ratio;
    return { x: start.x + sx * w, y: start.y + sy * h };
  }
}

export function ImageCropOverlay({
  imageUrl,
  onApply,
  onCancel,
  minSizePx = 12,
}: {
  imageUrl: string;
  onApply: (croppedDataUrl: string, dims: { width: number; height: number }) => void;
  onCancel: () => void;
  minSizePx?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragNow, setDragNow] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [ratio, setRatio] = useState<CropRatio>("free");
  const ratioNum = useMemo(() => ratioToNumber(ratio), [ratio]);

  const liveRect = useMemo(() => {
    if (dragStart && dragNow) return normalizeRect(dragStart, dragNow);
    return rect;
  }, [dragStart, dragNow, rect]);

  const toLocalPoint = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: clamp(clientX - r.left, 0, r.width), y: clamp(clientY - r.top, 0, r.height) };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toLocalPoint(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragStart(p);
    setDragNow(p);
  }, [toLocalPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toLocalPoint(e.clientX, e.clientY);
    if (!p) return;
    const constrained = ratioNum ? constrainPointToRatio(dragStart, p, ratioNum) : p;
    // Constrain again to container bounds after ratio adjustment
    const el = containerRef.current;
    if (!el) {
      setDragNow(constrained);
      return;
    }
    const r = el.getBoundingClientRect();
    setDragNow({ x: clamp(constrained.x, 0, r.width), y: clamp(constrained.y, 0, r.height) });
  }, [dragStart, ratioNum, toLocalPoint]);

  const commitDrag = useCallback(() => {
    if (!dragStart || !dragNow) return;
    const r = normalizeRect(dragStart, dragNow);
    setDragStart(null);
    setDragNow(null);
    if (r.w < minSizePx || r.h < minSizePx) {
      setRect(null);
      return;
    }
    setRect(r);
  }, [dragNow, dragStart, minSizePx]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    commitDrag();
  }, [commitDrag]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && rect) void handleApply();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel, rect]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleApply = useCallback(async () => {
    if (isApplying) return;
    const el = containerRef.current;
    if (!el) return;
    const r = rect;
    if (!r || r.w < minSizePx || r.h < minSizePx) return;

    setIsApplying(true);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = imageUrl;
      });

      const container = el.getBoundingClientRect();
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (!naturalW || !naturalH) return;

      // The underlying image is rendered with object-fit: cover.
      const scale = Math.max(container.width / naturalW, container.height / naturalH);
      const renderedW = naturalW * scale;
      const renderedH = naturalH * scale;
      const offsetX = (container.width - renderedW) / 2;
      const offsetY = (container.height - renderedH) / 2;

      const sx = clamp((r.x - offsetX) / scale, 0, naturalW);
      const sy = clamp((r.y - offsetY) / scale, 0, naturalH);
      const sw = clamp(r.w / scale, 0, naturalW - sx);
      const sh = clamp(r.h / scale, 0, naturalH - sy);

      const outW = Math.max(1, Math.round(sw));
      const outH = Math.max(1, Math.round(sh));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const dataUrl = canvas.toDataURL("image/png");
      onApply(dataUrl, { width: outW, height: outH });
    } finally {
      setIsApplying(false);
    }
  }, [imageUrl, isApplying, minSizePx, onApply, rect]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[999] select-none"
      style={{ pointerEvents: "auto" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Darken + hint */}
      <div className="absolute inset-0 bg-black/45" />

      {/* Selection */}
      {liveRect && liveRect.w >= 1 && liveRect.h >= 1 && (
        <div
          className="absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={{
            left: `${liveRect.x}px`,
            top: `${liveRect.y}px`,
            width: `${liveRect.w}px`,
            height: `${liveRect.h}px`,
          }}
        >
          <div className="absolute -top-6 left-0 text-[10px] text-white/90 bg-black/60 px-1.5 py-0.5 rounded">
            Drag to crop • Enter to apply • Esc to cancel
          </div>
        </div>
      )}

      {/* Bottom actions */}
      <div
        className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2"
        onPointerDown={(e) => {
          // Prevent starting a drag when interacting with controls
          e.stopPropagation();
        }}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <div className="nodrag nopan flex items-center gap-1 rounded-xl border border-white/15 bg-neutral-950/70 px-2 py-1">
          <span className="text-[10px] text-white/70">Ratio</span>
          <select
            value={ratio}
            onChange={(e) => setRatio(e.target.value as CropRatio)}
            className="nodrag nopan bg-transparent text-[11px] text-white/90 focus:outline-none"
            title="Crop ratio"
          >
            <option value="free">Free</option>
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
            <option value="3:2">3:2</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan rounded-xl border border-white/15 bg-neutral-950/70 px-3 py-1.5 text-[11px] text-white/90 hover:bg-neutral-900"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!rect || isApplying}
          onClick={(e) => {
            e.stopPropagation();
            void handleApply();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="nodrag nopan rounded-xl bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApplying ? "Applying..." : "Apply crop"}
        </button>
      </div>
    </div>
  );
}

