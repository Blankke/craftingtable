// 用法：canvasTextFromMarkdown('# 标题') 导入格式；canvasTextPlainText(doc) 提取纯文本。
// 解析在 Node 与渲染进程共用；原始 HTML 按文字处理，链接仅保留安全协议。
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import type { RichTextDocument, RichTextNode } from './richText';

export const CANVAS_TEXT_WIDTH = 320;
export function emptyCanvasText(): RichTextDocument { return { type: 'doc', content: [{ type: 'paragraph' }] }; }
export function isCanvasTextEmpty(document?: RichTextDocument): boolean {
  return !document || document.content.every(node => node.type === 'paragraph' && (node.content ?? []).every(child => child.type === 'hardBreak' || (child.type === 'text' && !child.text)));
}
export function canvasTextFromPlainText(value: string): RichTextDocument {
  return { type: 'doc', content: value.replace(/\r\n?/g, '\n').split('\n').map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) };
}
export function canvasTextPlainText(document?: RichTextDocument): string {
  const visit = (node: RichTextNode): string => node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(visit).join(['doc', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type) ? '\n' : '');
  return document ? visit(document) : '';
}
export const safeTextLink = (href: string): string => /^(https?:|mailto:)/i.test(href) ? href : '';
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
function inlineNodes(tokens: Token[]): RichTextNode[] {
  const nodes: RichTextNode[] = [], marks: NonNullable<RichTextNode['marks']> = [];
  const add = (text: string, extra: NonNullable<RichTextNode['marks']> = []) => { if (text) nodes.push({ type: 'text', text, ...((marks.length || extra.length) ? { marks: [...marks, ...extra] } : {}) }); };
  for (const token of tokens) {
    const mark = ({ strong_open: 'bold', em_open: 'italic', s_open: 'strike' } as Record<string, string>)[token.type];
    if (mark) marks.push({ type: mark });
    else if (['strong_close', 'em_close', 's_close', 'link_close'].includes(token.type)) marks.pop();
    else if (token.type === 'link_open') marks.push({ type: 'link', attrs: { href: safeTextLink(String(token.attrGet('href') ?? '')) } });
    else if (token.type === 'code_inline') add(token.content, [{ type: 'code' }]);
    else if (token.type === 'softbreak' || token.type === 'hardbreak') nodes.push({ type: 'hardBreak' });
    else if (token.type === 'image') add(token.content);
    else add(token.content);
  }
  return nodes;
}
export function canvasTextFromMarkdown(source: string): RichTextDocument {
  const document: RichTextDocument = { type: 'doc', content: [] }, stack: RichTextNode[] = [document];
  const append = (node: RichTextNode) => { const parent = stack.at(-1)!; (parent.content ??= []).push(node); };
  const blocks: Record<string, string> = { paragraph_open: 'paragraph', heading_open: 'heading', bullet_list_open: 'bulletList', ordered_list_open: 'orderedList', list_item_open: 'listItem', blockquote_open: 'blockquote', table_open: 'table', tr_open: 'tableRow', th_open: 'tableHeader', td_open: 'tableCell' };
  for (const token of markdown.parse(source, {})) {
    if (['thead_open', 'thead_close', 'tbody_open', 'tbody_close'].includes(token.type)) continue;
    if (token.nesting === -1) { stack.pop(); continue; }
    if (blocks[token.type]) {
      const node: RichTextNode = { type: blocks[token.type], content: [] };
      if (node.type === 'heading') node.attrs = { level: Number(token.tag.slice(1)) };
      if (node.type === 'orderedList') node.attrs = { start: Number(token.attrGet('start') ?? 1) };
      append(node); stack.push(node);
    } else if (token.type === 'inline') {
      const content = inlineNodes(token.children ?? []), parent = stack.at(-1)!;
      if (['tableHeader', 'tableCell'].includes(parent.type)) append({ type: 'paragraph', content });
      else (parent.content ??= []).push(...content);
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const text = token.content.replace(/\n$/, '');
      append({ type: 'codeBlock', attrs: { language: token.info.trim().split(/\s/)[0] || null }, ...(text ? { content: [{ type: 'text', text }] } : {}) });
    } else if (token.type === 'hr') append({ type: 'horizontalRule' });
  }
  // 待办与普通列表使用各自的节点，防止保存 Markdown 方括号作为正文。
  const tasks = (node: RichTextNode) => {
    node.content?.forEach(tasks);
    if (node.type !== 'bulletList' || !node.content?.some(item => /^\[[ xX]\]\s/.test(item.content?.[0]?.content?.[0]?.text ?? ''))) return;
    node.type = 'taskList';
    for (const item of node.content) {
      const first = item.content?.[0]?.content?.[0], match = first?.text?.match(/^\[([ xX])\]\s+/);
      item.type = 'taskItem'; item.attrs = { checked: !!match && match[1].toLowerCase() === 'x' };
      if (match && first?.text) { first.text = first.text.slice(match[0].length); if (!first.text) item.content![0].content!.shift(); }
    }
  };
  tasks(document);
  return document.content.length ? document : emptyCanvasText();
}

export const escapeTextHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function canvasTextHtml(document?: RichTextDocument): string {
  const render = (node: RichTextNode): string => {
    const content = (node.content ?? []).map(render).join('');
    if (node.type === 'text') return (node.marks ?? []).reduce((html, mark) => {
      const tag = ({ bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code' } as Record<string, string>)[mark.type];
      if (tag) return `<${tag}>${html}</${tag}>`;
      const href = mark.type === 'link' ? safeTextLink(String(mark.attrs?.href ?? '')) : '';
      if (mark.type === 'textStyle') {
        const size = String(mark.attrs?.fontSize ?? ''), font = String(mark.attrs?.fontFamily ?? '');
        const style = `${/^\d+(\.\d+)?px$/.test(size) ? `font-size:${size};` : ''}${/^[\w\s,-]+$/.test(font) ? `font-family:${font};` : ''}`;
        if (style) return `<span style="${escapeTextHtml(style)}">${html}</span>`;
      }
      return href ? `<a href="${escapeTextHtml(href)}">${html}</a>` : html;
    }, escapeTextHtml(node.text ?? ''));
    if (node.type === 'hardBreak') return '<br/>';
    if (node.type === 'horizontalRule') return '<hr/>';
    if (node.type === 'codeBlock') return `<pre><code>${content}</code></pre>`;
    const align = ['left', 'center', 'right', 'justify'].includes(String(node.attrs?.textAlign)) ? ` style="text-align:${node.attrs!.textAlign}"` : '';
    if (node.type === 'heading') { const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)); return `<h${level}${align}>${content || '<br/>'}</h${level}>`; }
    if (node.type === 'orderedList') return `<ol start="${Number(node.attrs?.start) || 1}">${content}</ol>`;
    if (node.type === 'taskList') return `<ul data-type="taskList">${content}</ul>`;
    if (node.type === 'taskItem') return `<li data-type="taskItem" data-checked="${!!node.attrs?.checked}"><label contenteditable="false"><input type="checkbox"${node.attrs?.checked ? ' checked="checked"' : ''}/></label><div>${content}</div></li>`;
    const tag = ({ paragraph: 'p', bulletList: 'ul', listItem: 'li', blockquote: 'blockquote', table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th' } as Record<string, string>)[node.type];
    return tag ? `<${tag}${node.type === 'paragraph' ? align : ''}>${content || (node.type === 'paragraph' ? '<br/>' : '')}</${tag}>` : content;
  };
  return (document ?? emptyCanvasText()).content.map(render).join('');
}
