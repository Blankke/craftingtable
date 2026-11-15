export type TimeTick = { timeUs: number; x: number; label: string };

function formatTime(timeUs: number): string {
  const seconds = Math.floor(timeUs / 1_000_000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

// 相邻刻度至少约 50 像素，并限制长轨道的绘制数量。
export function trackTicks(inUs: number, outUs: number, pixelsPerSecond: number): TimeTick[] {
  if (outUs <= inUs || pixelsPerSecond <= 0) return [];
  const targetSeconds = Math.max(50 / pixelsPerSecond, (outUs - inUs) / 1_000_000 / 100);
  let intervalSeconds = 1;
  while (intervalSeconds < targetSeconds) {
    const scale = 10 ** Math.floor(Math.log10(intervalSeconds));
    const next = [2, 5, 10].map(value => value * scale).find(value => value > intervalSeconds);
    intervalSeconds = next ?? intervalSeconds * 10;
  }
  const intervalUs = Math.round(intervalSeconds * 1_000_000);
  const result: TimeTick[] = [];
  for (let timeUs = Math.ceil(inUs / intervalUs) * intervalUs; timeUs <= outUs && result.length < 101; timeUs += intervalUs) {
    result.push({ timeUs, x: (timeUs - inUs) / 1_000_000 * pixelsPerSecond, label: formatTime(timeUs) });
  }
  return result;
}
