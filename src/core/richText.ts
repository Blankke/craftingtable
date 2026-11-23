// 用法：richTextDocumentSchema.parse(value) 校验笔记和画布共用的结构化正文。
// 契约统一保存节点与格式标记；具体 Markdown 输入行为由各编辑入口决定。
import { z } from 'zod';

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichTextNode[];
}
const jsonNodeSchema: z.ZodType<RichTextNode> = z.lazy(() => z.object({
  type: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
  text: z.string().optional(),
  marks: z.array(z.object({ type: z.string().min(1), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
  content: z.array(jsonNodeSchema).optional()
}).superRefine((node, context) => {
  if (node.type === 'text' && typeof node.text !== 'string') context.addIssue({ code: z.ZodIssueCode.custom, message: '文本节点缺少内容' });
  if (node.type === 'projectImage' && typeof node.attrs?.assetId !== 'string') context.addIssue({ code: z.ZodIssueCode.custom, message: '笔记图片缺少素材引用' });
}));

export const richTextDocumentSchema = z.object({ type: z.literal('doc'), content: z.array(jsonNodeSchema) });
export type RichTextDocument = z.infer<typeof richTextDocumentSchema>;
