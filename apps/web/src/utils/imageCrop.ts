const JPEG_QUALITY = 0.88;

export type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function cropImageFile(
  file: File,
  crop: CropArea,
  outputWidth: number,
  outputHeight: number
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      ctx.drawImage(
        img,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        outputWidth,
        outputHeight
      );
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Crop failed"));
            return;
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, ".jpg") || "crop.jpg", {
              type: "image/jpeg",
            })
          );
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}
