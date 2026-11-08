// Keep the gem close to its rolled position while leaving book links clickable.
export function diamondPosition({ x, y }, links) {
  const offsets = [[0, 0], [14, 0], [-14, 0], [0, 10], [0, -10], [14, 10], [-14, -10]];
  const bound = (value) => Math.max(8, Math.min(92, value));
  const rectangles = links.map(({ x, y, w, h }) => [x, y, w, h].map(Number))
    .filter(([x, y, w, h]) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0);
  const isClear = (left, top) => rectangles.every(([x, y, w, h]) =>
    left + 8 < x || left - 8 > x + w || top + 6 < y || top - 6 > y + h);
  for (const [dx, dy] of offsets) {
    const left = bound(x + dx);
    const top = bound(y + dy);
    if (isClear(left, top)) return { x: left, y: top };
  }

  let nearest;
  let distance = Infinity;
  for (let left = 8; left <= 92; left += 4) {
    for (let top = 8; top <= 92; top += 4) {
      const candidateDistance = (left - x) ** 2 + (top - y) ** 2;
      if (candidateDistance < distance && isClear(left, top)) {
        distance = candidateDistance;
        nearest = { x: left, y: top };
      }
    }
  }
  return nearest ?? { x: bound(x), y: bound(y) };
}
