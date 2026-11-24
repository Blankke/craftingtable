// 用法：imagePreviewEdge(画布宽度, 高度, 相机缩放, 设备像素比, 裁剪区域)。
// 采用固定档位减少连续缩放时的解码次数；预览上限不影响项目中保存的全尺寸图片。
export const IMAGE_PREVIEW_EDGES = [128, 256, 512, 1024, 2048, 4096] as const;
export function imagePreviewEdge(width: number, height = width, scale = 1, devicePixelRatio = 1, crop?: { width: number; height: number }): number {
  const pixels = Math.max(width / (crop?.width ?? 1), height / (crop?.height ?? 1)) * scale * devicePixelRatio;
  return IMAGE_PREVIEW_EDGES.find(edge => edge >= pixels) ?? 4096;
}
