// 使用示例：npm run verify。验证定位请求不会被媒体元素的旧时间事件覆盖。
import { afterEach, describe, expect, it } from 'vitest';
import { usePlaybackStore } from './playbackStore';

describe('播放状态', () => {
  afterEach(() => usePlaybackStore.getState().setPlayback(null));

  it('忽略定位前的旧时间事件并保留播放请求', () => {
    const mediaId = crypto.randomUUID();
    usePlaybackStore.getState().setPlayback({ mediaId, timeUs: 1_250_000, play: true });
    expect(usePlaybackStore.getState().updateFromMedia(mediaId, 0, 1_600_000)).toBe(false);
    expect(usePlaybackStore.getState().playback).toEqual({ mediaId, timeUs: 1_250_000, play: true });
    expect(usePlaybackStore.getState().updateFromMedia(mediaId, 1_250_000, 1_600_000)).toBe(true);
    expect(usePlaybackStore.getState().playback).toEqual({ mediaId, timeUs: 1_250_000, play: true });
  });

  it('到达裁剪终点后时间停在 Out 并暂停', () => {
    const mediaId = crypto.randomUUID();
    usePlaybackStore.getState().setPlayback({ mediaId, timeUs: 1_250_000, play: true });
    usePlaybackStore.getState().updateFromMedia(mediaId, 1_250_000, 1_600_000);
    expect(usePlaybackStore.getState().updateFromMedia(mediaId, 1_620_000, 1_600_000)).toBe(true);
    expect(usePlaybackStore.getState().playback).toEqual({ mediaId, timeUs: 1_600_000, play: false });
  });
});
