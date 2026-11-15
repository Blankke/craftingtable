import type { ProjectDocument } from './document';

// 同一调度器只服务一个项目；连续编辑的最长等待时间固定为两秒。
export class Autosave {
  private latest: ProjectDocument | null = null;
  private savedRevision: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly save: (document: ProjectDocument) => Promise<unknown>,
    private readonly onState: (state: '已保存' | '未保存' | '保存失败') => void,
    initialRevision: number
  ) { this.savedRevision = initialRevision; }

  schedule(document: ProjectDocument): void {
    if (this.disposed || document.revision <= this.savedRevision) return;
    this.latest = document;
    this.onState('未保存');
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, 600);
    if (!this.deadlineTimer) this.deadlineTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, 2000);
  }

  flush(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.debounceTimer = null;
    this.deadlineTimer = null;
    // 每次显式提交排队；前一笔失败后，后续提交仍可用内存中的最新文档重试。
    const next = this.saveTail.catch(() => undefined).then(async () => {
      while (this.latest && this.latest.revision > this.savedRevision) {
        const snapshot = this.latest;
        try {
          await this.save(snapshot);
          this.savedRevision = snapshot.revision;
          if (this.latest?.revision === snapshot.revision) this.onState('已保存');
        } catch (error) { this.onState('保存失败'); throw error; }
      }
    });
    this.saveTail = next;
    return next;
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
  }
}
