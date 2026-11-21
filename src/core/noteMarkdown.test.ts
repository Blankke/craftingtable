// 运行示例：npx vitest run src/core/noteMarkdown.test.ts。覆盖真实 Markdown 与阅读批注的位置映射。
import { describe, expect, it } from 'vitest';
import { newNote, type NoteDocument } from './note';
import { exportNoteMarkdown, noteMarkdownSource, renderNoteMarkdown } from './noteMarkdown';

const documentOf = (text: string): NoteDocument => ({ type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) });

describe('笔记 Markdown', () => {
  it('导出保留手写语法，同时序列化格式、编号和多行引用', () => {
    const document: NoteDocument = { type: 'doc', content: [
      ...documentOf('# 手写标题\n**手写粗体**').content,
      { type: 'paragraph', content: [{ type: 'text', text: '工具栏粗体', marks: [{ type: 'bold' }] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第三项' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第四项' }] }] }
      ] },
      { type: 'blockquote', content: documentOf('引用一\n引用二').content }
    ] };
    const output = exportNoteMarkdown(document, []);
    expect(output).toContain('# 手写标题\n**手写粗体**');
    expect(output).toContain('**工具栏粗体**');
    expect(output).toContain('3. 第三项\n4. 第四项');
    expect(output).toContain('> 引用一\n> 引用二');
    expect(renderNoteMarkdown(document, [])).toContain('<ol start="3">');
  });
  it('保留源标记并渲染标题、行内格式、列表、表格、脚注和公式', () => {
    const source = '# 标题\n\n**粗体** *斜体* ~~删除~~ ==高亮==\n\n- [x] 完成\n- [ ] 待办\n\n| 项目 | 值 |\n| --- | --- |\n| 时间 | 12 |\n\n引用[^1]\n\n[^1]: 脚注内容\n\n$x^2$';
    const doc = documentOf(source);
    const html = renderNoteMarkdown(doc, []);
    for (const expected of ['<h1>', '<strong>', '<em>', '<s>', '<mark>', '<table>', 'task-list-item', 'footnote', 'katex']) expect(html).toContain(expected);
    expect(noteMarkdownSource(doc).text.trimEnd()).toBe(source);
  });
  it('Obsidian 折叠提示块和代码围栏互不干扰', () => {
    const html = renderNoteMarkdown(documentOf('> [!warning]- 说明\n> 正文\n> > [!tip] 内层\n> > 建议\n\n```js\nconst text = "[!note]";\n```'), []);
    expect(html).toContain('<details class="note-callout" data-callout="warning" >');
    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('[!note]');
  });
  it('重复文字和链接后的文字映射到各自源位置', () => {
    const doc = documentOf('相同 **相同** [相同](https://example.com/相同) 相同');
    const html = renderNoteMarkdown(doc, []);
    const mapped = [...html.matchAll(/data-note-positions="([\d,]+)">([^<]*)/g)]
      .filter(match => match[2].includes('相同')).map(match => Number(match[1].split(',')[match[2].indexOf('相同')]));
    expect(mapped).toHaveLength(4);
    expect(new Set(mapped).size).toBe(4);
    expect(mapped[3]).toBe(doc.content[0].content![0].text!.lastIndexOf('相同') + 1);
  });
  it('提示块标题与正文同名、实体后 emoji 都保持正确选区位置', () => {
    const callout = documentOf('> [!tip] 重复\n> 重复');
    const html = renderNoteMarkdown(callout, []);
    const source = noteMarkdownSource(callout);
    const start = source.text.lastIndexOf('重复');
    expect(html).toContain(`data-note-positions="${source.positions[start]},${source.positions[start + 1]}"`);
    const entity = renderNoteMarkdown(documentOf('&amp;🙂正文'), []);
    expect(entity).toContain('data-note-positions="1,6,7,8,9"');
  });
  it('保留跨段批注标记与选区格式', () => {
    const note = newNote('批注');
    note.document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原文', marks: [{ type: 'noteAnnotation', attrs: { id: 'comment', color: '#8cb8e8' } }, { type: 'textStyle', attrs: { fontSize: '24px' } }] }] }] };
    const html = renderNoteMarkdown(note.document, []);
    expect(html).toContain('data-note-annotation="comment"');
    expect(html).toContain('--annotation-color:#8cb8e8');
    expect(html).toContain('font-size:24px');
  });
  it('附件支持尺寸与对齐，双链指向项目笔记', () => {
    const html = renderNoteMarkdown(documentOf('![[图片.png|240|right]]\n[[下一篇|继续阅读]]'), [{ id: 'asset', name: '图片.png', kind: 'image', path: 'assets/p.png', status: 'ready' }], [{ id: 'note', name: '下一篇' }], path => `project-media://asset/${path}`);
    expect(html).toContain('width="240"'); expect(html).toContain('data-align="right"');
    expect(html).toContain('project-media://asset/assets/p.png'); expect(html).toContain('data-open-note="note"');
  });
  it('用户 HTML 与危险链接按普通文字显示', () => {
    const html = renderNoteMarkdown(documentOf('<script>alert(1)</script>\n[x](javascript:alert(1))'), []);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:');
  });
});
