import { useEffect, useRef } from "react";
import QRCodeGenerator from "qrcode";

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Real QR code generator using the qrcode library.
 * Encodes the provided value into a scannable QR code.
 */
export function QRCode({ value, size = 128, className = "" }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Generate real QR code using qrcode library
    QRCodeGenerator.toCanvas(
      canvas,
      value,
      {
        width: size,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      },
      (error) => {
        if (error) {
          console.error("QR code generation failed:", error);
        }
      }
    );
  }, [value, size]);

  return (
    <canvas
      ref={canvasRef}
      className={`rounded-lg ${className}`}
    />
  );
}
