// 使用范例：renderNoteMarkdown(note.document, assets, notes) 返回可用于阅读和分屏的安全 HTML。
// 编辑正文始终保存在 Tiptap JSON 中；源字符与 ProseMirror 位置的映射用于在渲染结果上划线、批注。
// Obsidian 提示块、附件尺寸和代码语言规则参考用户的 Blankke/my_blog/.vitepress/plugins/obsidian-compat.ts。
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import tasks from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
import type { Token } from 'markdown-it';
import type { Note, NoteDocument, NoteJsonNode } from './note';
import type { ProjectDocument } from './document';

type TextMark = NonNullable<NoteJsonNode['marks']>[number];
type MarkdownSource = { text: string; positions: number[]; marks: Map<number, TextMark[]> };
type RenderContext = MarkdownSource & { assets: ProjectDocument['assets']; notes: Pick<Note, 'id' | 'name'>[]; mediaUrl(path: string): string };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** 正文、阅读映射和导出共用序列化规则；手写语法不转义，生成的符号没有正文位置。 */
export function noteMarkdownSource(document: NoteDocument, exportAssets?: ProjectDocument['assets']): MarkdownSource {
  const marks = new Map<number, TextMark[]>();
  type Fragment = { text: string; positions: number[] };
  const literal = (text: string): Fragment => ({ text, positions: Array(text.length).fill(-1) });
  const join = (...parts: Fragment[]): Fragment => ({ text: parts.map(part => part.text).join(''), positions: parts.flatMap(part => part.positions) });
  const prefixLines = (part: Fragment, first: string, rest = first): Fragment => {
    const pieces: Fragment[] = [];
    let offset = 0;
    for (const line of part.text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      pieces.push(literal(offset === 0 ? first : rest), { text: line, positions: part.positions.slice(offset, offset + line.length) });
      offset += line.length;
    }
    return join(...pieces);
  };
  const sizeOf = (node: NoteJsonNode): number => node.type === 'text' ? (node.text ?? '').length : ['projectImage', 'hardBreak', 'horizontalRule'].includes(node.type) ? 1 : 2 + (node.content ?? []).reduce((size, child) => size + sizeOf(child), 0);
  const visit = (node: NoteJsonNode, position: number): Fragment => {
    if (node.type === 'text') {
      const text = node.text ?? '';
      let result: Fragment = { text, positions: Array.from({ length: text.length }, (_, index) => position + index) };
      result.positions.forEach(at => { if (node.marks?.length) marks.set(at, node.marks); });
      if (exportAssets) for (const mark of node.marks ?? []) {
        const delimiter = ({ bold: '**', italic: '*', strike: '~~', highlight: '==', code: String.fromCharCode(96) } as Record<string, string>)[mark.type];
        if (delimiter) result = join(literal(delimiter), result, literal(delimiter));
        if (mark.type === 'underline') result = join(literal('<u>'), result, literal('</u>'));
        if (mark.type === 'link') result = join(literal('['), result, literal('](' + encodeURI(String(mark.attrs?.href ?? '')).replace(/\(/g, '%28').replace(/\)/g, '%29') + ')'));
      }
      return result;
    }
    if (node.type === 'hardBreak') return literal('\n');
    if (node.type === 'horizontalRule') return literal('\n---\n');
    if (node.type === 'projectImage') {
      const asset = exportAssets?.find(asset => asset.id === node.attrs?.assetId);
      // 导出引用项目相对路径；阅读时保留稳定素材 ID 和图片排版信息。
      return literal(exportAssets ? '\n![图片](' + encodeURI(asset?.path ?? '') + ')\n' : '\n![[' + node.attrs?.assetId + '|' + (node.attrs?.width ?? 320) + '|' + (node.attrs?.align ?? 'center') + ']]\n');
    }
    let offset = position + 1;
    const children = (node.content ?? []).map(child => { const part = visit(child, offset); offset += sizeOf(child); return part; });
    let result = join(...children);
    if (node.type === 'heading') return join(literal('#'.repeat(Number(node.attrs?.level) || 1) + ' '), result, literal('\n'));
    if (node.type === 'paragraph') return join(result, literal('\n'));
    if (node.type === 'codeBlock') {
      const fence = String.fromCharCode(96).repeat(Math.max(3, ...[...result.text.matchAll(/\x60+/g)].map(match => match[0].length + 1)));
      return join(literal('\n' + fence + (node.attrs?.language ?? '') + '\n'), result, literal('\n' + fence + '\n'));
    }
    if (node.type === 'blockquote') return prefixLines(result, '> ');
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type)) {
      result = join(...children.map((part, index) => {
        const item = node.content![index];
        const prefix = node.type === 'orderedList' ? String((Number(node.attrs?.start) || 1) + index) + '. ' : node.type === 'taskList' ? '- [' + (item.attrs?.checked ? 'x' : ' ') + '] ' : '- ';
        return prefixLines(part, prefix, ' '.repeat(prefix.length));
      }));
      result = join(literal('\n'), result, literal('\n'));
    }
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      const trim = result.text.endsWith('\n') ? 1 : 0;
      return { text: result.text.slice(0, trim ? -1 : undefined).replace(/\n/g, ' '), positions: trim ? result.positions.slice(0, -1) : result.positions };
    }
    if (node.type === 'tableRow') {
      result = join(literal('| '), ...children.flatMap(child => [child, literal(' | ')]), literal('\n'));
      if (node.content?.some(cell => cell.type === 'tableHeader')) result = join(result, literal('|' + children.map(() => ' --- |').join('') + '\n'));
    }
    return result;
  };
  let position = 0;
  const fragments = document.content.map(node => { const result = visit(node, position); position += sizeOf(node); return result; });
  return { ...join(...fragments), marks };
}

export function exportNoteMarkdown(document: NoteDocument, assets: ProjectDocument['assets']): string {
  return noteMarkdownSource(document, assets).text.trimEnd();
}

const languageAliases: Record<string, string> = { py: 'python', rs: 'rust', sh: 'bash', shell: 'bash', zsh: 'bash', cxx: 'cpp', 'c++': 'cpp', h: 'c', ts: 'typescript', js: 'javascript' };
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true, highlight(code, info) {
  const name = info.split(/\s/)[0].toLowerCase();
  const extension = name.split('.').at(-1) ?? name;
  const language = languageAliases[name] ?? languageAliases[extension] ?? extension;
  return hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escape(code);
} }).use(footnote).use(mark).use(tasks, { enabled: false }).use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false, trust: false, strict: 'ignore' } });

// 附件按项目内 ID、相对路径或文件名解析，不读取任意本地路径。
function findAsset(target: string, assets: ProjectDocument['assets']) {
  let decoded = target;
  try { decoded = decodeURIComponent(target); } catch { /* 不合法转义按字面匹配。 */ }
  return assets.find(asset => asset.id === decoded || asset.path === decoded.replace(/^\.\//, '') || asset.name === decoded);
}
markdown.inline.ruler.before('image', 'obsidian_reference', (state, silent) => {
  const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const token = state.push(match[1] ? 'note_embed' : 'note_link', '', 0);
    token.content = match[2]; token.meta = { raw: match[0] };
  }
  state.pos += match[0].length;
  return true;
});
markdown.renderer.rules.note_embed = (tokens, index, _options, rawEnv) => {
  const env = rawEnv as RenderContext;
  const [target, width, align] = tokens[index].content.split('|');
  const asset = findAsset(target.trim(), env.assets);
  if (!asset || asset.kind !== 'image') return `<span class="note-missing-asset">附件未找到 · ${escape(target)}</span>`;
  const size = /^\d+$/.test(width ?? '') ? Math.max(80, Math.min(1600, Number(width))) : 320;
  return `<img class="note-preview-image" data-project-asset="${asset.id}" data-align="${['left', 'right'].includes(align) ? align : 'center'}" src="${escape(env.mediaUrl(asset.path))}" alt="${escape(asset.name)}" width="${size}" />`;
};
markdown.renderer.rules.note_link = (tokens, index, _options, rawEnv) => {
  const env = rawEnv as RenderContext;
  const [target, alias] = tokens[index].content.split('|');
  const note = env.notes.find(note => note.id === target || note.name === target.replace(/\.md$/, ''));
  return note ? `<button class="note-wikilink" data-open-note="${note.id}">${escape(alias ?? target)}</button>` : `<span class="note-missing-link">${escape(alias ?? target)}</span>`;
};
const defaultImage = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, rawEnv, self) => {
  const env = rawEnv as RenderContext;
  const token = tokens[index];
  const asset = findAsset(String(token.attrGet('src') ?? ''), env.assets);
  if (asset) { token.attrSet('src', env.mediaUrl(asset.path)); token.attrSet('data-project-asset', asset.id); }
  token.attrJoin('class', 'note-preview-image');
  return defaultImage(tokens, index, options, env, self);
};

const calloutNames: Record<string, string> = { note: '笔记', info: '信息', tip: '提示', warning: '警告', danger: '危险', success: '完成', question: '问题', example: '示例', quote: '引用', abstract: '摘要', todo: '待办', bug: '缺陷', failure: '失败' };
const calloutAliases: Record<string, string> = { hint: 'tip', important: 'tip', caution: 'warning', attention: 'warning', error: 'danger', check: 'success', done: 'success', faq: 'question', help: 'question', cite: 'quote', summary: 'abstract', tldr: 'abstract', fail: 'failure', missing: 'failure' };
markdown.core.ruler.after('inline', 'note_callouts', state => {
  for (let index = 0; index < state.tokens.length; index++) {
    const opening = state.tokens[index];
    const inline = state.tokens[index + 2];
    if (opening.type !== 'blockquote_open' || inline?.type !== 'inline') continue;
    const match = /^\[!([\w-]+)\]([+-])?\s*([^\n]*)(?:\n|$)/.exec(inline.content);
    if (!match) continue;
    let level = 1, closeIndex = index + 1;
    for (; closeIndex < state.tokens.length; closeIndex++) {
      if (state.tokens[closeIndex].type === 'blockquote_open') level++;
      if (state.tokens[closeIndex].type === 'blockquote_close' && --level === 0) break;
    }
    const kind = calloutAliases[match[1].toLowerCase()] ?? match[1].toLowerCase();
    const title = match[3].trim() || calloutNames[kind] || kind;
    opening.type = 'note_callout_open';
    opening.meta = { fold: match[2], title, kind };
    state.tokens[closeIndex].type = 'note_callout_close';
    state.tokens[closeIndex].meta = opening.meta;
    inline.content = inline.content.slice(match[0].length);
    inline.meta = { sourceLineOffset: (match[0].match(/\n/g) ?? []).length };
    inline.children = [];
    state.md.inline.parse(inline.content, state.md, state.env, inline.children);
  }
});
markdown.renderer.rules.note_callout_open = (tokens, index) => {
  const { fold, title, kind } = tokens[index].meta!;
  return fold ? `<details class="note-callout" data-callout="${escape(kind)}" ${fold === '+' ? 'open' : ''}><summary>${escape(title)}</summary>` : `<aside class="note-callout" data-callout="${escape(kind)}"><strong>${escape(title)}</strong>`;
};
markdown.renderer.rules.note_callout_close = (tokens, index) => tokens[index].meta?.fold ? '</details>' : '</aside>';

// inline token 的可见文字可跨越 Markdown 分隔符；逐段匹配源位置，重复文本从当前游标继续查找。
markdown.core.ruler.after('text_join', 'note_positions', state => {
  const env = state.env as RenderContext;
  const lineStarts = [0];
  for (let index = 0; index < state.src.length; index++) if (state.src[index] === '\n') lineStarts.push(index + 1);
  let cursor = 0;
  for (const block of state.tokens) {
    if (block.type !== 'inline') continue;
    if (block.map) cursor = lineStarts[block.map[0] + Number(block.meta?.sourceLineOffset ?? 0)] ?? cursor;
    for (const token of block.children ?? []) {
      if (token.type === 'link_close') {
        const closing = /^\]\([^\n]*?\)/.exec(state.src.slice(cursor));
        if (closing) cursor += closing[0].length;
      }
      if (token.type === 'note_embed' || token.type === 'note_link') {
        const raw = String(token.meta?.raw ?? '');
        const start = state.src.indexOf(raw, cursor);
        if (start >= 0) cursor = start + raw.length;
      }
      if (token.type === 'image') {
        const end = state.src.indexOf(')', cursor);
        if (end >= 0) cursor = end + 1;
      }
      if (token.type !== 'text' && token.type !== 'code_inline') continue;
      const positions: number[] = [];
      const start = state.src.indexOf(token.content, cursor);
      if (start >= 0) {
        for (let index = 0; index < token.content.length; index++) positions.push(env.positions[start + index] ?? -1);
        cursor = start + token.content.length;
      } else {
        // 转义和 HTML 实体会改变可见字符长度，显式把每个可见字符映射到原始源范围。
        for (const char of token.content) {
          let found = -1, consumed = 1;
          for (let index = cursor; index < state.src.length; index++) {
            const entity = /^&(?:#x?[\da-f]+|\w+);/i.exec(state.src.slice(index));
            if (entity && state.md.utils.unescapeAll(entity[0]) === char) { found = index; consumed = entity[0].length; break; }
            if (state.src.startsWith(char, index)) { found = index; consumed = char.length; break; }
          }
          // DOM Range 和 ProseMirror 都使用 UTF-16 偏移，emoji 必须占两项。
          for (let unit = 0; unit < char.length; unit++) positions.push(found < 0 ? -1 : env.positions[found + Math.min(unit, consumed - 1)] ?? -1);
          if (found >= 0) cursor = found + consumed;
        }
      }
      token.meta = { ...token.meta, positions };
    }
  }
});

function renderText(token: Token, env: RenderContext): string {
  const positions = (token.meta?.positions ?? []) as number[];
  const parts: string[] = [];
  let start = 0;
  while (start < token.content.length) {
    const marks = env.marks.get(positions[start]) ?? [];
    let end = start + 1;
    while (end < token.content.length && JSON.stringify(env.marks.get(positions[end]) ?? []) === JSON.stringify(marks)) end++;
    let html = `<span data-note-positions="${positions.slice(start, end).join(',')}">${escape(token.content.slice(start, end))}</span>`;
    for (const item of marks) {
      if (['bold', 'italic', 'underline', 'strike'].includes(item.type)) {
        const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strike: 's' })[item.type]!;
        html = `<${tag}>${html}</${tag}>`;
      }
      if (item.type === 'code') html = `<code>${html}</code>`;
      if (item.type === 'highlight' || item.type === 'noteAnnotation') {
        const color = /^#[\da-f]{6}$/i.test(String(item.attrs?.color)) ? String(item.attrs?.color) : '#efc969';
        const id = item.type === 'noteAnnotation' ? ` data-note-annotation="${escape(item.attrs?.id)}"` : '';
        html = `<mark${id} style="--annotation-color:${color}">${html}</mark>`;
      }
      if (item.type === 'textStyle') {
        const size = /^\d+(?:\.\d+)?px$/.test(String(item.attrs?.fontSize)) ? `font-size:${item.attrs?.fontSize};` : '';
        const font = String(item.attrs?.fontFamily ?? '').replace(/[^\w\s-]/g, '');
        html = `<span style="${size}font-family:${escape(font)}">${html}</span>`;
      }
      if (item.type === 'link' && /^(https?:|mailto:)/i.test(String(item.attrs?.href))) html = `<a href="${escape(item.attrs?.href)}">${html}</a>`;
    }
    parts.push(html); start = end;
  }
  return parts.join('');
}
markdown.renderer.rules.text = (tokens, index, _options, rawEnv) => renderText(tokens[index], rawEnv as RenderContext);
markdown.renderer.rules.code_inline = (tokens, index, _options, rawEnv) => `<code>${renderText(tokens[index], rawEnv as RenderContext)}</code>`;

export function renderNoteMarkdown(document: NoteDocument, assets: ProjectDocument['assets'], notes: Pick<Note, 'id' | 'name'>[] = [], mediaUrl = (path: string) => path): string {
  const source = noteMarkdownSource(document);
  return markdown.render(source.text, { ...source, assets, notes, mediaUrl } satisfies RenderContext);
}
