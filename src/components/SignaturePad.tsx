import { useRef, useEffect, useState } from "react";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear?: () => void;
  width?: number;
  height?: number;
  className?: string;
}

// The canvas is drawn at a fixed resolution but shown at the width of its container, so
// pointer positions (CSS pixels) are scaled into canvas pixels.
function pointerPosition(
  canvas: HTMLCanvasElement,
  e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
) {
  const rect = canvas.getBoundingClientRect();
  const point = "touches" in e ? e.touches[0]! : e;
  return {
    x: ((point.clientX - rect.left) * canvas.width) / (rect.width || canvas.width),
    y: ((point.clientY - rect.top) * canvas.height) / (rect.height || canvas.height),
  };
}

export function SignaturePad({ onSave, onClear, width = 400, height = 200, className = "" }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set white background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Configure drawing
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsDrawing(true);
    setHasDrawn(true);

    const { x, y } = pointerPosition(canvas, e);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    e.preventDefault(); // Prevent scrolling on touch devices

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { x, y } = pointerPosition(canvas, e);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onClear?.();
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    // Convert to data URL (PNG)
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full touch-none cursor-crosshair rounded-xl border-2 border-glass-line bg-white"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClear}
          className="rounded-xl border border-glass-line px-4 py-2 text-sm font-semibold text-soft hover:bg-glass-bright"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasDrawn}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-50"
        >
          Save Signature
        </button>
      </div>
    </div>
  );
}
