// 使用范例：npm run test:unit；验证优化后的撤销隔离、缓存预算与流式峰值的等价性。
import { describe, expect, it } from 'vitest';
import { BoundedCache } from './boundedCache';
import { shareSnapshot } from './shareSnapshot';
import { Editor } from './editor';
import { newDocument } from './document';
import { canvasTextFromPlainText } from './canvasText';
import { aggregatePeaks, StreamingPeaks } from './waveform';

describe('有界缓存', () => {
  it('按访问顺序和字节预算淘汰，超预算条目不挤占缓存', () => {
    const cache = new BoundedCache<string, string>(2, 10);
    cache.set('a', 'A', 4); cache.set('b', 'B', 4); expect(cache.get('a')).toBe('A');
    cache.set('c', 'C', 4); expect(cache.get('b')).toBeUndefined();
    cache.set('large', 'large', 11); expect(cache.get('a')).toBe('A');
    cache.set('a', 'new', 7); expect(cache.get('c')).toBeUndefined();
    cache.delete('a'); cache.set('d', 'D', 10); expect(cache.get('d')).toBe('D');
    cache.clear(); expect(cache.get('d')).toBeUndefined();
  });
});

describe('撤销快照共享', () => {
  it('重排仍复用对应实体，深层变化只替换变化分支', () => {
    const old = [{ id: 'a', data: { text: 'a' } }, { id: 'b', data: { text: 'b' } }];
    const reordered = shareSnapshot(old, structuredClone([old[1], old[0]]));
    expect(reordered[0]).toBe(old[1]); expect(reordered[1]).toBe(old[0]);
    const changed = structuredClone(old); changed[0].data.text = 'new';
    const shared = shareSnapshot(old, changed);
    expect(shared[1]).toBe(old[1]); expect(shared[0]).not.toBe(old[0]); expect(old[0].data.text).toBe('a');
  });
  it('完整撤销与预览取消保留正文，并且后续嵌套编辑不污染历史', () => {
    const doc = newDocument('历史');
    for (let i = 0; i < 10; i++) doc.objects.push({ id: crypto.randomUUID(), kind: 'text', x: i * 100, y: 0, width: 90, height: 60, groupId: null, text: canvasTextFromPlainText('原文'), fontSize: 18, color: '#123456', align: 'left' });
    const editor = new Editor(doc), initial = editor.document;
    for (let i=0;i<25;i++) editor.execute(draft => { draft.objects[0].x++; });
    expect(editor.document.objects[1]).toBe(initial.objects[1]);
    const current = editor.document.objects[0];
    if (current.kind !== 'text') throw Error('夹具类型错误');
    expect(current.text).toBe((initial.objects[0] as typeof current).text);
    editor.execute(draft => { const object=draft.objects[0]; if(object.kind==='text')object.text.content[0].content![0].text='新文'; });
    expect(current.text.content[0].content![0].text).toBe('原文');
    editor.undo();
    editor.preview(draft => { draft.objects[0].x=300; }); editor.cancelPreview();
    expect(editor.document.objects[0].x).toBe(25);
    for(let i=0;i<25;i++)editor.undo();
    expect(editor.document.objects).toBe(initial.objects);
    for(let i=0;i<26;i++)editor.redo();
    expect(editor.document.objects[0].x).toBe(25);
    expect((editor.document.objects[0] as typeof current).text.content[0].content![0].text).toBe('新文');
  });
});

describe('流式音频峰值', () => {
  it('任意字节分块与整段算法逐列一致，包含非整数列边界及空输入', () => {
    for (const size of [0, 1, 67, 8111]) for (const rate of [80, 8000]) {
      const pcm = Int16Array.from({length:size}, (_,i) => (i * 7919 % 65536)-32768);
      const bytes = new Uint8Array(size*2); const view=new DataView(bytes.buffer);
      pcm.forEach((value,i)=>view.setInt16(i*2,value,true));
      for(const chunk of [1, 3, 512, 4096]) {
        const stream=new StreamingPeaks(rate,120);
        for(let offset=0;offset<bytes.length;offset+=chunk)stream.push(bytes.subarray(offset,offset+chunk));
        stream.push(new Uint8Array(0));
        const result=stream.finish();
        expect(result.columns).toEqual(aggregatePeaks(pcm,rate,120));
        expect(result.durationUs).toBe(Math.round(size/rate*1_000_000));
      }
    }
  });
  it('最后不足一个采样的字节不改变有效样本', () => {
    const stream = new StreamingPeaks(8000,120); stream.push(new Uint8Array([255,127,0]));
    expect([...stream.finish().columns]).toEqual([32767,32767]);
  });
});

describe('相机快速提交', () => {
  it('与通用提交保存结果一致，校验、预览、撤销和重做语义不变', () => {
    const fast = new Editor(newDocument('相机')), reference = new Editor(fast.document);
    for (let i=0;i<20;i++) {
      fast.updateCamera(camera => { camera.x+=3; camera.y-=2; camera.scale*=1.01; });
      reference.execute(draft => { draft.camera.x+=3; draft.camera.y-=2; draft.camera.scale*=1.01; });
      expect(fast.document).toEqual(reference.document);
    }
    const previous = fast.document;
    fast.updateCamera(() => {}); expect(fast.document).toBe(previous);
    expect(() => fast.updateCamera(camera => { camera.scale=0; })).toThrow();
    expect(fast.document).toBe(previous);
    for(let i=0;i<20;i++) { fast.undo(); reference.undo(); expect(fast.document).toEqual(reference.document); }
    for(let i=0;i<20;i++) { fast.redo(); reference.redo(); expect(fast.document).toEqual(reference.document); }
    fast.preview(draft=>{draft.name='预览';}); fast.updateCamera(camera=>{camera.x=999;});
    fast.undo(); expect(fast.document.name).toBe('预览'); fast.undo(); expect(fast.document.name).toBe('相机');
  });
  it('空预览和可选字段 undefined 不产生额外历史', () => {
    const editor = new Editor(newDocument('空操作'));
    editor.preview(()=>{}); editor.commitPreview(); expect(editor.canUndo).toBe(false);
    const original: {a:number;b?:undefined}={a:1}; expect(shareSnapshot(original,{a:1,b:undefined})).toBe(original);
  });
});
