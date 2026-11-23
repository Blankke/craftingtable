// 用法：new BoundedCache<string, Value>(条目上限, 权重上限)；set 时传入字节数等权重。
// 最近读取的条目优先保留，超预算数据不缓存；淘汰只释放缓存引用，不影响使用中的值。
export class BoundedCache<K, V> {
  private entries = new Map<K, { value: V; weight: number }>();
  private weight = 0;
  constructor(private readonly maxEntries: number, private readonly maxWeight = Infinity) {}
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, weight = 1): void {
    this.delete(key);
    if (weight > this.maxWeight || this.maxEntries <= 0) return;
    this.entries.set(key, { value, weight }); this.weight += weight;
    while (this.entries.size > this.maxEntries || this.weight > this.maxWeight) this.delete(this.entries.keys().next().value!);
  }
  delete(key: K): void {
    const entry = this.entries.get(key);
    if (entry) { this.weight -= entry.weight; this.entries.delete(key); }
  }
  clear(): void { this.entries.clear(); this.weight = 0; }
}
