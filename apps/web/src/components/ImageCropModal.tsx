import { useCallback, useEffect, useRef, useState } from "react";
import { cropImageFile, type CropArea } from "../utils/imageCrop";

type Props = {
  file: File;
  aspect: number;
  title: string;
  outputWidth: number;
  outputHeight: number;
  onConfirm: (file: File) => void;
  onCancel: () => void;
};

const VIEW_W = 320;

function clampOffset(
  offset: number,
  viewport: number,
  imageSize: number
): number {
  if (imageSize <= viewport) return (viewport - imageSize) / 2;
  return Math.min(0, Math.max(viewport - imageSize, offset));
}

export default function ImageCropModal({
  file,
  aspect,
  title,
  outputWidth,
  outputHeight,
  onConfirm,
  onCancel,
}: Props) {
  const viewH = Math.round(VIEW_W / aspect);
  const [previewUrl, setPreviewUrl] = useState("");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const fitScale = useCallback(
    (nw: number, nh: number) => Math.max(VIEW_W / nw, viewH / nh),
    [viewH]
  );

  useEffect(() => {
    if (!previewUrl) return;
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const s = fitScale(nw, nh);
      const dw = nw * s;
      const dh = nh * s;
      setNatural({ w: nw, h: nh });
      setScale(s);
      setOffset({
        x: clampOffset((VIEW_W - dw) / 2, VIEW_W, dw),
        y: clampOffset((viewH - dh) / 2, viewH, dh),
      });
    };
    img.src = previewUrl;
  }, [previewUrl, fitScale, viewH]);

  const displayW = natural.w * scale;
  const displayH = natural.h * scale;

  function cropAreaFromView(): CropArea {
    const x = (-offset.x) / scale;
    const y = (-offset.y) / scale;
    const width = VIEW_W / scale;
    const height = viewH / scale;
    return {
      x: Math.max(0, Math.min(natural.w - width, x)),
      y: Math.max(0, Math.min(natural.h - height, y)),
      width: Math.min(width, natural.w),
      height: Math.min(height, natural.h),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset({
      x: clampOffset(dragRef.current.ox + dx, VIEW_W, displayW),
      y: clampOffset(dragRef.current.oy + dy, viewH, displayH),
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onZoomChange(next: number) {
    const s = Math.max(fitScale(natural.w, natural.h), Math.min(fitScale(natural.w, natural.h) * 3, next));
    const cx = VIEW_W / 2;
    const cy = viewH / 2;
    const ratio = s / scale;
    const nx = cx - (cx - offset.x) * ratio;
    const ny = cy - (cy - offset.y) * ratio;
    setScale(s);
    setOffset({
      x: clampOffset(nx, VIEW_W, natural.w * s),
      y: clampOffset(ny, viewH, natural.h * s),
    });
  }

  async function handleConfirm() {
    if (!natural.w) return;
    setBusy(true);
    try {
      const cropped = await cropImageFile(file, cropAreaFromView(), outputWidth, outputHeight);
      onConfirm(cropped);
    } finally {
      setBusy(false);
    }
  }

  const minScale = natural.w ? fitScale(natural.w, natural.h) : 1;

  return (
    <div className="search-overlay image-crop-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="search-modal image-crop-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Закрыть">
          ×
        </button>
        <h3>{title}</h3>
        <p className="image-crop-hint">Перетащите и масштабируйте фото</p>
        <div
          className="image-crop-viewport"
          style={{ width: VIEW_W, height: viewH }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt=""
              className="image-crop-image"
              style={{
                width: displayW,
                height: displayH,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
              draggable={false}
            />
          )}
          <div className="image-crop-frame" aria-hidden />
        </div>
        <label className="image-crop-zoom">
          Масштаб
          <input
            type="range"
            min={minScale}
            max={minScale * 3}
            step={0.01}
            value={scale}
            onChange={(e) => onZoomChange(Number(e.target.value))}
          />
        </label>
        <div className="image-crop-actions">
          <button type="button" className="btn" onClick={() => void handleConfirm()} disabled={busy || !natural.w}>
            {busy ? "…" : "Применить"}
          </button>
        </div>
      </div>
    </div>
  );
}
