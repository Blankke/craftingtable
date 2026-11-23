// 用法：CanvasStage 传入命中的对象/连线；菜单按选区能力启用，共用编辑器命令及系统剪贴板。
import { useState } from 'react';
import { Trash2, Scissors, Copy, ClipboardPaste, CopyPlus, Group, Ungroup, Lock, Unlock, BringToFront, SendToBack, ArrowUp, ArrowDown, Image, FileCode2, Paintbrush, Settings2, Link2, ExternalLink, Crop, Layers, Type, Undo2, Redo2, MousePointer2, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, ArrowUpRight, CirclePlus } from 'lucide-react';
import type { CanvasObject } from '../../core/document';
import type { Editor } from '../../core/editor';
import { styleOf } from '../../core/appearance';
import { ContextMenu, type MenuItem } from '../shared/ContextMenu';
import { CommandDialog, type CommandField } from '../shared/CommandDialog';
import { useLanguage } from '../shared/language';
import { saveDefaultStyle } from './canvasCommands';
import { isTextObject } from './canvasTextLayout';
import { copyCanvasSelection, pasteCanvasSelection } from '../../core/canvasClipboard';
import { useInteractionStore } from './interactionStore';
export type CanvasMenuTarget = { x: number; y: number; ids: string[]; connections: string[] };
export function CanvasObjectMenu({ target, editor, close, select, focus, editText, inspect, openStack, openNote, connect, exportGraphic }: {
  target: CanvasMenuTarget | null; editor: Editor; close(): void; select(ids: string[]): void; focus(): void; editText(id: string): void; inspect(tab?: string): void; openStack(id: string): void; openNote(id: string): void; connect(): void; exportGraphic(objects: CanvasObject[], format: 'png' | 'svg'): Promise<void>;
}) {
  const { t } = useLanguage();
  const setSelection = useInteractionStore(state => state.setSelection);
  const duplicate = () => { const pasted = pasteCanvasSelection(editor, copyCanvasSelection(editor, ids, connections)); setSelection(pasted.objects, pasted.connections); };
  const [dialog, setDialog] = useState<{ title: string; fields: CommandField[]; submit(values: Record<string, string>): void } | null>(null);
  const ids = target ? [...editor.expandObjectIds(target.ids)] : [], objects = editor.document.objects.filter(object => ids.includes(object.id));
  const object = objects[0], locked = objects.some(object => object.locked), connections = target?.connections ?? [];
  const clip = (command: 'copy' | 'cut' | 'paste') => { focus(); void window.workbench!.clipboardCommand(command); };
  const run = (action: () => Promise<void>) => { void action().catch(error => alert(String(error))); };
  const update = (object: CanvasObject, values: Partial<CanvasObject>) => editor.execute(draft => { const current = draft.objects.find(item => item.id === object.id); if (current && !current.locked) Object.assign(current, values); });
  const formatting: MenuItem[] = [
    ...([{ id: 'bold', label: t('粗体', 'Bold'), icon: <Bold/>, shortcut: 'Ctrl+B' }, { id: 'italic', label: t('斜体', 'Italic'), icon: <Italic/>, shortcut: 'Ctrl+I' }, { id: 'underline', label: t('下划线', 'Underline'), icon: <Underline/>, shortcut: 'Ctrl+U' }] as const).map(item => ({ ...item, checked: object ? styleOf(object)[item.id] : false, run: () => editor.formatObjects(ids, item.id) })),
    ...([{ id: 'left', label: t('左对齐', 'Align left'), icon: <AlignLeft/>, shortcut: 'Ctrl+Shift+L' }, { id: 'center', label: t('居中对齐', 'Align center'), icon: <AlignCenter/>, shortcut: 'Ctrl+Shift+E' }, { id: 'right', label: t('右对齐', 'Align right'), icon: <AlignRight/>, shortcut: 'Ctrl+Shift+R' }] as const).map((item, index) => ({ ...item, separator: index === 0, run: () => editor.formatObjects(ids, item.id) }))
  ];
  const items: MenuItem[] = objects.length ? [
    { id: 'delete', label: t('删除', 'Delete'), icon: <Trash2/>, shortcut: 'Delete', danger: true, disabled: locked, run: () => { editor.deleteObjects(ids, connections); select([]); } },
    { id: 'cut', label: t('剪切', 'Cut'), icon: <Scissors/>, shortcut: 'Ctrl+X', separator: true, disabled: locked, run: () => clip('cut') },
    { id: 'copy', label: t('复制', 'Copy'), icon: <Copy/>, shortcut: 'Ctrl+C', run: () => clip('copy') },
    { id: 'paste', label: t('粘贴', 'Paste'), icon: <ClipboardPaste/>, shortcut: 'Ctrl+V', run: () => clip('paste') },
    { id: 'duplicate', label: t('创建副本', 'Duplicate'), icon: <CopyPlus/>, shortcut: 'Ctrl+D', run: duplicate },
    { id: 'png', label: t('复制为图像', 'Copy as image'), icon: <Image/>, run: () => run(() => exportGraphic(objects, 'png')) },
    { id: 'svg', label: t('复制为 SVG', 'Copy as SVG'), icon: <FileCode2/>, run: () => run(() => exportGraphic(objects, 'svg')) },
    { id: 'group', label: t('组合', 'Group'), icon: <Group/>, shortcut: 'Ctrl+G', separator: true, disabled: locked || objects.length < 2, run: () => editor.group(ids) },
    { id: 'ungroup', label: t('取消组合', 'Ungroup'), icon: <Ungroup/>, shortcut: 'Ctrl+Shift+G', disabled: locked || !objects.some(object => object.groupId), run: () => editor.ungroupObjects(ids) },
    ...(objects.length >= 2 && objects.every(object => object.kind === 'image' || object.kind === 'imageStack') ? [{ id: 'stack', label: t('收起为叠图', 'Stack images'), icon: <Layers/>, disabled: locked, run: () => select([editor.stackImages(ids)]) }] : []),
    ...(objects.length === 1 && object.kind === 'imageStack' ? [{ id: 'view-stack', label: t('查看叠图', 'View image stack'), icon: <Layers/>, run: () => openStack(object.id) }, { id: 'unstack', label: t('拆开叠图', 'Unstack images'), disabled: locked, run: () => select(editor.unstackImages(object.id)) }] : []),
    { id: 'lock', label: objects.every(object => object.locked) ? t('解锁', 'Unlock') : t('锁定', 'Lock'), icon: locked ? <Unlock/> : <Lock/>, shortcut: 'Ctrl+L', separator: true, run: () => editor.setLocked(ids, !objects.every(object => object.locked)) },
    { id: 'default', label: t('设置为默认样式', 'Set as default style'), icon: <Paintbrush/>, disabled: objects.length !== 1, run: () => saveDefaultStyle(object) },
    ...([{ id: 'front', label: t('置于顶层', 'Bring to front'), icon: <BringToFront/>, shortcut: 'Ctrl+Shift+]' }, { id: 'back', label: t('置于底层', 'Send to back'), icon: <SendToBack/>, shortcut: 'Ctrl+Shift+[' }, { id: 'forward', label: t('上移一层', 'Bring forward'), icon: <ArrowUp/>, shortcut: 'Ctrl+]' }, { id: 'backward', label: t('下移一层', 'Send backward'), icon: <ArrowDown/>, shortcut: 'Ctrl+[' }] as const).map((item, index) => ({ ...item, separator: index === 0, disabled: locked, run: () => editor.reorderObjects(ids, item.id) })),
    { id: 'style', label: t('编辑样式…', 'Edit style…'), icon: <Paintbrush/>, separator: true, disabled: locked, run: inspect },
    ...(objects.every(isTextObject) ? [{ id: 'format', label: t('文本格式', 'Text format'), icon: <Type/>, disabled: locked, children: formatting }] : []),
    ...(objects.length === 1 ? [
      ...(isTextObject(object) ? [{ id: 'text', label: t('编辑文字', 'Edit text'), icon: <Type/>, disabled: locked, run: () => editText(object.id) }] : []),
      ...(object.kind === 'note' ? [{ id: 'note', label: t('打开笔记', 'Open note'), run: () => openNote(object.noteId) }] : []),
      { id: 'data', label: t('编辑数据…', 'Edit data…'), icon: <Settings2/>, disabled: locked, run: () => setDialog({ title: t('对象信息', 'Object information'), fields: [{ key: 'name', label: t('名称', 'Name'), value: object.name ?? '' }, { key: 'description', label: t('说明', 'Description'), value: object.description ?? '', multiline: true }], submit: values => update(object, values) }) },
      { id: 'link', label: t('编辑链接…', 'Edit link…'), icon: <Link2/>, disabled: locked, run: () => setDialog({ title: t('对象链接', 'Object link'), fields: [{ key: 'href', label: t('链接地址', 'Link URL'), value: object.href ?? '' }], submit: values => { const href = values.href.trim(); if (href && !/^(https?:\/\/|mailto:)/i.test(href)) throw Error(t('请输入 https:// 或 mailto: 链接', 'Enter an https:// or mailto: link')); update(object, { href }); } }) },
      ...(object.href ? [{ id: 'open-link', label: t('打开链接', 'Open link'), icon: <ExternalLink/>, run: () => run(() => window.workbench!.openLink(object.href!)) }] : []),
      ...(object.kind === 'image' ? [{ id: 'image-edit', label: t('编辑图片…', 'Edit image…'), icon: <Image/>, disabled: locked, separator: true, run: () => inspect('排列') }, { id: 'crop', label: t('裁剪…', 'Crop…'), icon: <Crop/>, disabled: locked, run: () => { update(object, { crop: object.crop ?? { x: 0, y: 0, width: 1, height: 1 } }); inspect('排列'); } }] : []),
      { id: 'connect', label: t('添加连接线', 'Add connection'), icon: <ArrowUpRight/>, separator: true, run: connect },
      { id: 'add-point', label: t('添加连接点', 'Add connection point'), icon: <CirclePlus/>, disabled: locked || (object.connectionPoints?.length ?? 0) >= 32, run: () => update(object, { connectionPoints: [...(object.connectionPoints ?? []), { id: crypto.randomUUID(), x: 1, y: .5 }] }) },
      { id: 'edit-points', label: t('编辑连接点…', 'Edit connection points…'), icon: <Settings2/>, disabled: locked, run: () => setDialog({ title: t('连接点位置', 'Connection point positions'), fields: [{ key: 'points', label: t('每行填写横向、纵向百分比（0–100），例如 100, 50', 'One x, y percentage pair per line (0–100), e.g. 100, 50'), value: (object.connectionPoints ?? []).map(point => `${point.x * 100}, ${point.y * 100}`).join('\n'), multiline: true }], submit: values => {
        const points = values.points.trim() ? values.points.trim().split('\n').map((line, index) => { const values = line.trim().split(/[,，\s]+/).map(Number); if (values.length !== 2 || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw Error(t('每行需要两个 0–100 的数字', 'Each line needs two numbers between 0 and 100')); return { id: object.connectionPoints?.[index]?.id ?? crypto.randomUUID(), x: values[0] / 100, y: values[1] / 100 }; }) : [];
        if (points.length > 32) throw Error(t('最多添加 32 个连接点', 'Up to 32 connection points'));
        editor.execute(draft => { const current = draft.objects.find(item => item.id === object.id); if (!current || current.locked) return; current.connectionPoints = points; for (const connection of draft.connections) for (const anchor of [connection.from, connection.to]) if (anchor.kind === 'object' && anchor.objectId === object.id && anchor.pointId && !points.some(point => point.id === anchor.pointId)) delete anchor.pointId; });
      } }) }
    ] : [])
  ] : connections.length ? [
    { id: 'delete', label: t('删除连接线', 'Delete connection'), icon: <Trash2/>, danger: true, shortcut: 'Delete', run: () => editor.deleteConnections(connections) },
    { id: 'cut', label: t('剪切', 'Cut'), icon: <Scissors/>, shortcut: 'Ctrl+X', separator: true, run: () => clip('cut') },
    { id: 'copy', label: t('复制', 'Copy'), icon: <Copy/>, shortcut: 'Ctrl+C', run: () => clip('copy') },
    { id: 'paste', label: t('粘贴', 'Paste'), icon: <ClipboardPaste/>, shortcut: 'Ctrl+V', run: () => clip('paste') },
    { id: 'duplicate', label: t('创建副本', 'Duplicate'), icon: <CopyPlus/>, shortcut: 'Ctrl+D', run: () => useInteractionStore.getState().setSelectedConnections(pasteCanvasSelection(editor, copyCanvasSelection(editor, [], connections)).connections) },
    { id: 'style', label: t('编辑样式…', 'Edit style…'), icon: <Paintbrush/>, run: inspect }
  ] : [
    { id: 'paste', label: t('粘贴', 'Paste'), icon: <ClipboardPaste/>, shortcut: 'Ctrl+V', run: () => clip('paste') },
    { id: 'all', label: t('全选', 'Select all'), icon: <MousePointer2/>, shortcut: 'Ctrl+A', run: () => setSelection(editor.document.objects.map(object => object.id), editor.document.connections.map(connection => connection.id)) },
    { id: 'undo', label: t('撤销', 'Undo'), icon: <Undo2/>, shortcut: 'Ctrl+Z', separator: true, disabled: !editor.canUndo, run: () => editor.undo() },
    { id: 'redo', label: t('重做', 'Redo'), icon: <Redo2/>, shortcut: 'Ctrl+Y', disabled: !editor.canRedo, run: () => editor.redo() }
  ];
  return <>{target && <ContextMenu {...target} items={items} label={t('画布右键菜单', 'Canvas context menu')} onClose={close} onRestoreFocus={focus}/>}{dialog && <CommandDialog title={dialog.title} fields={dialog.fields} onSubmit={dialog.submit} onClose={() => setDialog(null)}/>}</>;
}
