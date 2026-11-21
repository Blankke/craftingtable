// 用法：npm.cmd exec -- vitest run src/ui/home/helloPath.test.ts。防止字体路径生成器输出浏览器无法解析的坐标。
import { describe, expect, it } from 'vitest';
import { helloPath, helloViewBox } from './helloPath';

describe('Hello 字形路径', () => {
  it('包含完整字形且全部坐标为有限值', () => {
    expect(helloPath).toMatch(/^M/);
    expect(helloPath.match(/M/g)?.length).toBeGreaterThanOrEqual(5);
    expect(helloPath).not.toMatch(/NaN|Infinity|undefined/);
    expect(helloViewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true);
  });
});
