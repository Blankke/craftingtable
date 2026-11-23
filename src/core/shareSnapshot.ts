// 用法：shareSnapshot(previous, draft) 在校验完成后共享未改变的分支，保留完整撤销历史。
// draft 必须是独立副本；只改写副本，不修改历史。后续编辑仍先 structuredClone，隔离嵌套修改。
export function shareSnapshot<T>(previous: T, draft: T): T {
  if (Object.is(previous, draft)) return previous;
  if (!previous || !draft || typeof previous !== 'object' || typeof draft !== 'object') return draft;
  if (Array.isArray(previous) && Array.isArray(draft)) {
    // 对象重排/插入后仍按稳定 ID 找历史实体，正文节点等无 ID 数组按位置比较。
    const byId = previous.some(item => item && typeof item.id === 'string') ? new Map(previous.filter(item => item && typeof item.id === 'string').map(item => [item.id, item])) : null;
    let equal = previous.length === draft.length;
    for (let i = 0; i < draft.length; i++) {
      const old = draft[i] && typeof draft[i].id === 'string' ? byId?.get(draft[i].id) : previous[i];
      draft[i] = shareSnapshot(old, draft[i]);
      if (draft[i] !== previous[i]) equal = false;
    }
    return equal ? previous : draft;
  }
  if (Object.getPrototypeOf(previous) !== Object.prototype || Object.getPrototypeOf(draft) !== Object.prototype) {
    // 正文 attrs 允许附加值；对非普通对象沿用项目 JSON 的比较语义。
    return JSON.stringify(previous) === JSON.stringify(draft) ? previous : draft;
  }
  const old = previous as Record<string, unknown>, next = draft as Record<string, unknown>;
  // 可选字段的 undefined 与缺失在项目 JSON 中等价，保持原有空操作语义。
  const keys = Object.keys(next).filter(key => next[key] !== undefined);
  let equal = keys.length === Object.keys(old).filter(key => old[key] !== undefined).length;
  for (const key of keys) {
    next[key] = shareSnapshot(old[key], next[key]);
    if (!Object.hasOwn(old, key) || next[key] !== old[key]) equal = false;
  }
  return equal ? previous : draft;
}
