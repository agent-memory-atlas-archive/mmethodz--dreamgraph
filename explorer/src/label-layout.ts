/** Screen-space label budget and collision packing shared by graph views. */
export interface LabelCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
}

export interface PlacedLabel extends LabelCandidate {
  left: number;
  top: number;
}

export function placeLabels(
  candidates: readonly LabelCandidate[],
  viewportWidth: number,
  viewportHeight: number,
  limit = Math.max(4, Math.min(18, Math.floor(viewportWidth * viewportHeight / 45000))),
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    if (placed.length >= limit) break;
    const { x, y, width, height } = candidate;
    // Leave room for the heading, navigation tools and minimap.
    if (!Number.isFinite(x + y + width + height) || x < 0 || x > viewportWidth || y < 76 || y > viewportHeight - 100 || width > viewportWidth - 24) continue;
    const left = Math.max(12, Math.min(viewportWidth - width - 12, x - width / 2));
    const top = y - height - 9;
    if (placed.some((box) => left < box.left + box.width + 8 && left + width + 8 > box.left && top < box.top + box.height + 6 && top + height + 6 > box.top)) continue;
    placed.push({ ...candidate, left, top });
  }
  return placed;
}
