// 使用范例：npm.cmd exec -- vitest run src/core/canvasText.test.ts。
// 验证实际 Markdown 导入、结构化往返与安全 HTML 输出，防止格式只显示却未保存。
import { describe, expect, it } from 'vitest';
import { canvasTextFromMarkdown, canvasTextFromPlainText, canvasTextHtml, canvasTextPlainText } from './canvasText';
import { richTextDocumentSchema } from './richText';

describe('画布结构化文字', () => {
  it('标题、行内格式和嵌套列表转换为节点，源码标记不进入正文', () => {
    const source = '# 拍摄计划\n\n**重点**、*旁白*、~~删去~~ 与 [资料](https://example.com)\n\n- 现场\n  - 收音\n\n3. 剪辑\n4. 导出';
    const document = richTextDocumentSchema.parse(canvasTextFromMarkdown(source));
    expect(document.content.map(node => node.type)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList']);
    expect(document.content[0]).toMatchObject({ attrs: { level: 1 }, content: [{ text: '拍摄计划' }] });
    expect(document.content[1].content?.[0]).toMatchObject({ text: '重点', marks: [{ type: 'bold' }] });
    expect(document.content[3].attrs).toEqual({ start: 3 });
    expect(canvasTextPlainText(document)).not.toMatch(/\*\*|~~|https:\/\//);
    expect(canvasTextHtml(document)).toContain('<strong>重点</strong>');
    expect(canvasTextHtml(document)).toContain('<ul><li><p>收音</p></li></ul>');
    expect(richTextDocumentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });
  it('引用、代码、待办、分隔线、换行和表格保留结构', () => {
    const source = '> 引用\n> 第二行\n\n```js\nconst x = "**原样代码**";\n```\n\n- [x] 已完成\n- [ ] 待完成\n\n---\n\n| 镜头 | 内容 |\n| --- | --- |\n| A | **收音** |';
    const document = canvasTextFromMarkdown(source);
    expect(document.content.map(node => node.type)).toEqual(['blockquote', 'codeBlock', 'taskList', 'horizontalRule', 'table']);
    expect(document.content[1].content?.[0].text).toContain('**原样代码**');
    expect(document.content[2].content?.map(node => node.attrs?.checked)).toEqual([true, false]);
    expect(canvasTextHtml(document)).toContain('<th><p>镜头</p></th>');
    expect(canvasTextHtml(document)).toContain('<strong>收音</strong>');
    expect(canvasTextPlainText(document)).toContain('引用\n第二行');
  });
  it('HTML 与危险链接不能变成可执行内容，纯文本迁移不误转换原稿', () => {
    const document = canvasTextFromMarkdown('<script>alert(1)</script>\n\n[链接](javascript:alert(1))');
    const html = canvasTextHtml(document);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:');
    const literal = '**这是已有原稿**\n第二行';
    expect(canvasTextPlainText(canvasTextFromPlainText(literal))).toBe(literal);
    expect(canvasTextFromPlainText('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
