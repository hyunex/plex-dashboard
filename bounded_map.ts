/**
 * O(1) 크기 제한 LRU 맵: maxSize 초과 시 가장 오래 접근/등록되지 않은 항목 자동 축출
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(public readonly maxSize: number = 2000) {
    super();
  }

  override get(key: K): V | undefined {
    if (!this.has(key)) return undefined;
    const value = super.get(key)!;
    // LRU 갱신: 재삽입하여 가장 최근 순서로 이동
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    if (this.has(key)) {
      super.delete(key);
    } else if (this.size >= this.maxSize) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) {
        super.delete(oldestKey);
      }
    }
    super.set(key, value);
    return this;
  }
}
