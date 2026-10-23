// Resize an image file to a small square-ish JPEG/PNG data URL for avatars and logos.
export async function fileToResizedDataUrl(file: File, max = 256): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be smaller than 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image."));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert any image file (HEIC, WEBP, PNG, etc.) to a JPEG blob.
 * Resize to max size on longest side with specified quality.
 * This ensures photos work with storage buckets that only allow JPEG/PNG
 * and keeps file sizes reasonable for phone uploads.
 */
export async function convertToJpeg(file: File, maxSize = 1600, quality = 0.8): Promise<Blob> {
  // Accept any file that appears to be an image (HEIC shows as empty type on some browsers)
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image. Try a different photo format."));
      i.src = url;
    });

    // Calculate new dimensions (preserve aspect ratio, max size on longest side)
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context");

    // Draw with high quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Convert to JPEG blob
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to convert image to JPEG"));
        },
        "image/jpeg",
        quality
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
