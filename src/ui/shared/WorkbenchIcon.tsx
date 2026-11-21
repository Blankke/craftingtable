// 使用范例：<WorkbenchIcon name="text"/>。工作台统一采用 Lucide 线性图标。
import { Wrench, Images, Pencil, Type, MoveUpRight, Brush, MousePointer2, Undo2, Redo2, Palette, Settings } from "lucide-react";
const icons = { tools: Wrench, assets: Images, edit: Pencil, text: Type, arrow: MoveUpRight, brush: Brush, select: MousePointer2, undo: Undo2, redo: Redo2, palette: Palette, settings: Settings };
export type WorkbenchIconName = keyof typeof icons;
export function WorkbenchIcon({ name, size = 18 }: { name: WorkbenchIconName; size?: number }) {
  const Icon = icons[name];
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}
