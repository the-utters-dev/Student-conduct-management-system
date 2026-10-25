import { useEffect, useRef } from "react";

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Simple QR code generator using canvas.
 * For production, consider using a library like `qrcode` or `qr-code-styling`.
 * This is a placeholder that displays the verification code as text with a border pattern.
 */
export function QRCode({ value, size = 128, className = "" }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Simple placeholder: white background with text
    // In production, replace this with actual QR code generation using qrcode library
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, size, size);

    // Draw border pattern (simple QR-like squares in corners)
    ctx.fillStyle = "black";
    const cornerSize = size * 0.15;

    // Top-left corner
    ctx.fillRect(0, 0, cornerSize, cornerSize);
    ctx.fillStyle = "white";
    ctx.fillRect(cornerSize * 0.3, cornerSize * 0.3, cornerSize * 0.4, cornerSize * 0.4);

    // Top-right corner
    ctx.fillStyle = "black";
    ctx.fillRect(size - cornerSize, 0, cornerSize, cornerSize);
    ctx.fillStyle = "white";
    ctx.fillRect(size - cornerSize + cornerSize * 0.3, cornerSize * 0.3, cornerSize * 0.4, cornerSize * 0.4);

    // Bottom-left corner
    ctx.fillStyle = "black";
    ctx.fillRect(0, size - cornerSize, cornerSize, cornerSize);
    ctx.fillStyle = "white";
    ctx.fillRect(cornerSize * 0.3, size - cornerSize + cornerSize * 0.3, cornerSize * 0.4, cornerSize * 0.4);

    // Draw some random-looking squares in the middle (placeholder pattern)
    ctx.fillStyle = "black";
    const cellSize = size / 20;
    for (let i = 5; i < 15; i++) {
      for (let j = 5; j < 15; j++) {
        if ((i + j) % 2 === 0 || (i * j) % 3 === 0) {
          ctx.fillRect(i * cellSize, j * cellSize, cellSize * 0.9, cellSize * 0.9);
        }
      }
    }

    // Draw verification code text
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    ctx.font = `${size * 0.08}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value.substring(0, 12), size / 2, size / 2);

  }, [value, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`rounded-lg ${className}`}
    />
  );
}
