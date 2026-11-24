// 用法：导入与整理图片时传入 ImageCompression；新安装默认使用有损压缩。
import { z } from 'zod';
export const imageCompressionSchema = z.enum(['lossy', 'lossless']);
export type ImageCompression = z.infer<typeof imageCompressionSchema>;
export const DEFAULT_IMAGE_COMPRESSION: ImageCompression = 'lossy';
