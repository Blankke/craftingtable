import { canvasTextFromPlainText } from './canvasText';
// 用法：npm.cmd exec -- vitest run src/core/projectPreview.test.ts。核对首页预览来自项目内容。
import { describe, expect, it } from 'vitest';
import { newDocument } from './document';
import { newNote } from './note';
import { buildProjectPreview } from './projectPreview';

describe('项目首页预览', () => {
  it('空项目不生成装饰性预览', () => {
    expect(buildProjectPreview(newDocument('空项目'), new Map())).toEqual({});
  });

  it('预览包含实际画布对象、素材和笔记，并转义文本', () => {
    const document = newDocument('预览');
    const assetId = crypto.randomUUID();
    document.assets.push({ id: assetId, name: '图像', path: 'assets/picture.jpg', kind: 'image', status: 'ready' });
    document.objects.push({ id: crypto.randomUUID(), kind: 'text', x: 0, y: 0, width: 180, height: 40, groupId: null, text: canvasTextFromPlainText('<真实内容>'), fontSize: 16, color: '#222222', align: 'left' });
    document.objects.push({ id: crypto.randomUUID(), kind: 'image', x: 20, y: 50, width: 120, height: 80, groupId: null, assetId });
    document.objects.push({ id: crypto.randomUUID(), kind: 'diamond', x: 30, y: 20, width: 70, height: 55, rotation: 15, groupId: null, fill: '#ffeeaa', stroke: '#334455' });
    const note = newNote('笔记');
    note.document.content = [{ type: 'paragraph', content: [{ type: 'text', text: '一段实际笔记' }] }];
    document.notes.push(note);
    const preview = buildProjectPreview(document, new Map([[assetId, 'data:image/jpeg;base64,AAAA']]));
    expect(decodeURIComponent(preview.canvas!)).toContain('&lt;真实内容&gt;');
    expect(decodeURIComponent(preview.canvas!)).toContain('<image href="data:image/jpeg;base64,AAAA"');
    expect(decodeURIComponent(preview.canvas!)).toContain('M50 0 L100 50 L50 100 L0 50 Z');
    expect(decodeURIComponent(preview.canvas!)).toContain('rotate(15 ');
    expect(preview.media).toBe('data:image/jpeg;base64,AAAA');
    expect(decodeURIComponent(preview.note!)).toContain('一段实际笔记');
  });
});
