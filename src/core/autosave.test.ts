import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave } from './autosave';
import { newDocument } from './document';

describe('自动保存', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('连续编辑最迟两秒提交最新修订', async () => {
    const saved: number[] = [];
    const autosave = new Autosave(async document => { saved.push(document.revision); }, () => undefined, 0);
    const document = newDocument('测试');
    for (let revision = 1; revision <= 5; revision++) {
      autosave.schedule({ ...document, revision });
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(saved).toEqual([5]);
    autosave.dispose();
  });
  it('失败后可重试且不会把失败修订当作已保存', async () => {
    let attempts = 0;
    const states: string[] = [];
    const autosave = new Autosave(async () => { if (++attempts === 1) throw Error('磁盘错误'); }, state => states.push(state), 0);
    autosave.schedule({ ...newDocument('测试'), revision: 1 });
    await expect(autosave.flush()).rejects.toThrow('磁盘错误');
    await autosave.flush();
    expect(states).toEqual(['未保存', '保存失败', '已保存']);
    autosave.dispose();
  });
  it('恢复快照没有新编辑时也可提交到主文件', async () => {
    const saved: number[] = [];
    const snapshot = newDocument('恢复');
    const autosave = new Autosave(async document => { saved.push(document.revision); }, () => undefined, snapshot.revision - 1);
    autosave.schedule(snapshot);
    await autosave.flush();
    expect(saved).toEqual([snapshot.revision]);
    autosave.dispose();
  });
  it('后台重启期间并发重试会在旧写入失败后提交最新快照', async () => {
    let rejectFirst: ((reason: Error) => void) | undefined;
    const saved: number[] = [];
    let attempts = 0;
    const autosave = new Autosave(document => {
      if (++attempts === 1) return new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
      saved.push(document.revision);
      return Promise.resolve();
    }, () => undefined, 0);
    autosave.schedule({ ...newDocument('重启'), revision: 1 });
    const first = autosave.flush();
    for (let attempt = 0; attempt < 5 && !rejectFirst; attempt++) await Promise.resolve();
    expect(rejectFirst).toBeTypeOf('function');
    const retry = autosave.flush();
    rejectFirst?.(Error('后台已退出'));
    await expect(first).rejects.toThrow('后台已退出');
    await retry;
    expect(saved).toEqual([1]);
    autosave.dispose();
  });
  it('并发提交保持串行，且写入过程中出现的新修订不会丢失', async () => {
    const saved: number[] = [];
    let active = 0;
    let maximum = 0;
    let releaseFirst: (() => void) | undefined;
    const autosave = new Autosave(async document => {
      active++;
      maximum = Math.max(maximum, active);
      if (document.revision === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
      saved.push(document.revision);
      active--;
    }, () => undefined, 0);
    const initial = newDocument('串行');
    autosave.schedule({ ...initial, revision: 1 });
    const first = autosave.flush();
    for (let attempt = 0; attempt < 5 && !releaseFirst; attempt++) await Promise.resolve();
    expect(releaseFirst).toBeTypeOf('function');
    autosave.schedule({ ...initial, revision: 2 });
    const second = autosave.flush();
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(saved).toEqual([1, 2]);
    expect(maximum).toBe(1);
    autosave.dispose();
  });
});
