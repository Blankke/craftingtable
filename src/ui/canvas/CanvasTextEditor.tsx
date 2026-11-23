// 用法：CanvasTextEditor 在画布对象位置编辑；CanvasRichTextInput 同时供侧栏使用。
// 输入中的正文留在局部状态，完成或失焦一次提交；Esc 与中文组合输入独立处理。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, markInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Slice } from '@tiptap/pm/model';
import { canvasTextFromMarkdown, emptyCanvasText } from '../../core/canvasText';
import { richTextDocumentSchema, type RichTextDocument } from '../../core/richText';
import type { ProjectDocument } from '../../core/document';
import { useLanguage } from '../shared/language';
import { canvasTextLayout, canvasTextStyle, fitCanvasText, type TextObject } from './canvasTextLayout';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { FormattingShortcuts } from '../shared/FormattingShortcuts';
import { RichTextContextMenu } from '../shared/RichTextContextMenu';

// 中文正文与 Markdown 标记之间不要求空格；仅转换刚完成的加粗片段，保留其余富文本。
const InlineMarkdown = Extension.create({
  name: 'canvasInlineMarkdown',
  priority: 1100,
  addInputRules() {
    // 前置字符只参与断言，不能包含在替换范围中，否则中文标点也会被当成标记删除。
    return [markInputRule({ find: /(?<![*\\])(\*\*([^*\n]+)\*\*)$/, type: this.editor.schema.marks.bold })];
  }
});
const extensions = [InlineMarkdown, StarterKit.configure({ link: { openOnClick: false }, trailingNode: false }), TableKit, TaskList, TaskItem.configure({ nested: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyleKit.configure({ color: false, backgroundColor: false, lineHeight: false }), FormattingShortcuts];
export function CanvasRichTextInput(props: { value: RichTextDocument; label: string; style?: CSSProperties; autoFocus?: boolean; disabled?: boolean; onChange(value: RichTextDocument): void; onCommit(value: RichTextDocument): void; onCancel(): void }) {
  const latest = useRef(props); latest.current = props;
  const sessionActive = useRef(false);
  const editor = useEditor({
    extensions, content: props.value, autofocus: props.autoFocus ? 'end' : false, editable: !props.disabled,
    editorProps: {
      attributes: { class: 'canvas-rich-text', role: 'textbox', 'aria-label': props.label, 'aria-multiline': 'true' },
      handleDOMEvents: {
        keydown: (view, event) => {
          event.stopPropagation();
          if (event.isComposing || view.composing) return false;
          if (event.key === 'Escape') {
            event.preventDefault(); latest.current.onCancel();
            // 侧栏取消后退出焦点，让受控正文同步回已提交值；画布则由父组件结束编辑。
            view.dom.blur();
            return true;
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); latest.current.onCommit(richTextDocumentSchema.parse(view.state.doc.toJSON())); return true; }
          return false;
        },
        keyup: (_view, event) => { event.stopPropagation(); return false; }
      },
      handlePaste: (view, event) => {
        const source = event.clipboardData?.getData('text/plain');
        if (!source) return false;
        // 自身富文本复制保留格式；外部纯文本与 Markdown 统一导入结构化节点。
        if (event.clipboardData?.getData('text/html').includes('data-pm-slice')) return false;
        event.preventDefault();
        const content = canvasTextFromMarkdown(source);
        const fragment = view.state.schema.nodeFromJSON(content).content;
        view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(fragment)).scrollIntoView());
        return true;
      }
    },
    onUpdate: ({ editor }) => latest.current.onChange(richTextDocumentSchema.parse(editor.getJSON())),
    onFocus: () => { sessionActive.current = true; },
    onBlur: ({ editor, event }) => { if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-edit-menu],.command-dialog'))) { sessionActive.current = false; latest.current.onCommit(richTextDocumentSchema.parse(editor.getJSON())); } }
  });
  useEffect(() => {
    editor?.setEditable(!props.disabled);
  }, [editor, props.disabled]);
  useEffect(() => {
    // 从菜单直接点回画布时，正文已经失焦；补齐这条结束编辑的路径。
    const outside = (event: PointerEvent) => {
      if (!editor || !sessionActive.current || !(event.target instanceof Element) || editor.view.dom.contains(event.target) || event.target.closest('[data-edit-menu],.command-dialog,.canvas-text-done')) return;
      sessionActive.current = false; latest.current.onCommit(richTextDocumentSchema.parse(editor.getJSON()));
    };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [editor]);
  useEffect(() => {
    if (editor && !editor.isFocused && JSON.stringify(editor.getJSON()) !== JSON.stringify(props.value)) editor.commands.setContent(props.value, { emitUpdate: false });
  }, [editor, props.value]);
  return <><EditorContent editor={editor} style={props.style} /><RichTextContextMenu editor={editor}/></>;
}

export function CanvasTextEditor({ object, camera, onCommit, onCancel }: { object: TextObject; camera: ProjectDocument['camera']; onCommit(text: RichTextDocument, size: { width: number; height: number }): void; onCancel(): void }) {
  const { t } = useLanguage();
  const [text, setText] = useState(() => object.text ?? emptyCanvasText());
  const finished = useRef(false);
  const changed = useRef(false);
  const current = { ...object, text };
  fitCanvasText(current);
  const { width, height } = current;
  const layout = canvasTextLayout(current);
  const commit = (value: RichTextDocument) => {
    if (finished.current) return;
    finished.current = true;
    if (!changed.current) { onCancel(); return; }
    const final = { ...object, text: value }; fitCanvasText(final);
    onCommit(value, { width: final.width, height: final.height });
  };
  return <div className="canvas-text-overlay" style={{ left: (object.x + width / 2) * camera.scale + camera.x, top: (object.y + height / 2) * camera.scale + camera.y, transform: `scale(${camera.scale}) rotate(${object.rotation ?? 0}deg)` }}>
    <div style={{ position: 'absolute', left: -width / 2 + layout.x, top: -height / 2 + layout.y, width: layout.width }}>
      <CanvasRichTextInput value={text} label={t('编辑画布文字', 'Edit canvas text')} autoFocus style={{ ...canvasTextStyle(object), ...(object.writingMode === 'vertical-rl' ? { height } : {}) }} onChange={value => { changed.current = true; setText(value); }} onCommit={commit} onCancel={() => { finished.current = true; onCancel(); }} />
      <button className="canvas-text-done" aria-label={t('完成文字编辑', 'Finish text editing')} onMouseDown={event => event.preventDefault()} onClick={() => commit(text)}>{t('完成', 'Done')}</button>
    </div>
  </div>;
}
