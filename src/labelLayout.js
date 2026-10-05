// Pure screen-space layout: no React, DOM, or Three.js dependencies.
export function estimateLabelWidth(text, small = false) {
  const content = Array.from(String(text ?? '')).reduce((width, char) => {
    if (/\s/u.test(char)) return width + 4;
    return width + (char.codePointAt(0) > 255 ? 13 : 7.8);
  }, 0);
  return Math.min(180, Math.max(48, Math.ceil(content + (small ? 28 : 34))));
}

const bounded = (value, min, max) => Math.max(min, Math.min(max, value));
const overlaps = (a, b, gap = 6) => a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x && a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

function previousOffset(placement, axis) {
  const offsetKey = axis === 'x' ? 'offsetX' : 'offsetY';
  if (placement[offsetKey] != null && Number.isFinite(Number(placement[offsetKey]))) {
    return Number(placement[offsetKey]);
  }
  // Accept placements returned before explicit offsets were added.
  const position = Number(placement[axis] ?? placement[axis === 'x' ? 'left' : 'top']);
  const anchor = Number(placement[axis === 'x' ? 'anchorX' : 'anchorY']);
  return Number.isFinite(position) && Number.isFinite(anchor) ? position - anchor : null;
}

/**
 * items: {id, x, y, text, width?, height?, selected?, priority?}
 * x/y are projected anchors. Returns only visible labels, with x/y now the
 * top-left corner, plus anchorX/anchorY, width/height, and optional leader.
 * Selected labels take precedence, then numeric priority, then input order.
 * previousPlacements optionally retains each label's anchor-relative offset.
 * A retained position wins while it fits the viewport and avoids higher-priority
 * labels/reserved UI. Only an invalid position triggers a new candidate search.
 */
export function layoutLabels(items, width, height, {maxLabels = 5, reservedRects = [], previousPlacements = []} = {}) {
  const margin = 8;
  const screenWidth = Number(width), screenHeight = Number(height);
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight) ||
      screenWidth <= margin * 2 || screenHeight <= margin * 2) return [];
  const ordered = (Array.isArray(items) ? items : []).map((item, order) => ({item, order}))
    .sort((a, b) => Number(Boolean(b.item.fault)) - Number(Boolean(a.item.fault)) ||
      Number(Boolean(b.item.selected)) - Number(Boolean(a.item.selected)) ||
      Number(Boolean(b.item.active)) - Number(Boolean(a.item.active)) ||
      (Number(b.item.priority) || 0) - (Number(a.item.priority) || 0) || a.order - b.order);
  const previousById = new Map((Array.isArray(previousPlacements) ? previousPlacements : [])
    .filter(placement => placement && placement.id != null).map(placement => [placement.id, placement]));
  const placed = [];
  for (const {item, order} of ordered) {
    if (placed.length >= maxLabels) break;
    const anchorX = Number(item.anchorX ?? item.x), anchorY = Number(item.anchorY ?? item.y);
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) ||
        anchorX < 0 || anchorY < 0 || anchorX > screenWidth || anchorY > screenHeight) continue;
    const labelWidth = Math.min(screenWidth - margin * 2, 200,
      Math.max(20, Math.ceil(Number(item.width ?? item.w) || estimateLabelWidth(item.text, item.small))));
    const labelHeight = Math.min(screenHeight - margin * 2, 64,
      Math.max(20, Math.ceil(Number(item.height ?? item.h) || (item.small ? 26 : 30))));
    const id = item.id ?? order;
    const legal = candidate => candidate.x >= margin && candidate.y >= margin &&
      candidate.x + candidate.width <= screenWidth - margin &&
      candidate.y + candidate.height <= screenHeight - margin &&
      ![...placed, ...reservedRects].some(other => overlaps(candidate, other));
    let best = null, bestScore = Infinity;
    const previous = previousById.get(id);
    if (previous) {
      const offsetX = previousOffset(previous, 'x'), offsetY = previousOffset(previous, 'y');
      if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
        // Do not round or clamp the remembered offset. Subpixel anchor movement
        // should move the label by exactly the same amount; an edge violation
        // must be resolved by layout rather than accumulating offset drift.
        const candidate = {x: anchorX + offsetX, y: anchorY + offsetY,
          width: labelWidth, height: labelHeight};
        if (legal(candidate)) best = candidate;
      }
    }
    const desiredX = anchorX - labelWidth / 2, desiredY = anchorY - labelHeight - 10;
    const candidates = [[desiredX, desiredY], [anchorX + 12, anchorY - labelHeight / 2],
      [anchorX - labelWidth - 12, anchorY - labelHeight / 2], [desiredX, anchorY + 10]];
    for (const radius of (item.selected || item.fault ? [28, 48, 72, 100, 132] : [24, 44, 64])) {
      for (const [dx, dy] of [[0,-radius],[-radius,0],[radius,0],[0,radius],
        [-radius,-radius],[radius,-radius],[-radius,radius],[radius,radius]]) {
        candidates.push([desiredX + dx, desiredY + dy]);
      }
    }
    const seen = new Set();
    if (!best) candidates.forEach(([left, top], candidateIndex) => {
      const x = bounded(Math.round(left), margin, screenWidth - margin - labelWidth);
      const y = bounded(Math.round(top), margin, screenHeight - margin - labelHeight);
      const key = x + '/' + y;
      if (seen.has(key)) return;
      seen.add(key);
      const candidate = {x, y, width: labelWidth, height: labelHeight};
      if (!legal(candidate)) return;
      const score = (x - desiredX) ** 2 + (y - desiredY) ** 2 * 1.08 + candidateIndex * .001;
      if (score < bestScore) {best = candidate; bestScore = score;}
    });
    if (!best) continue;
    const nearX = bounded(anchorX, best.x, best.x + labelWidth);
    const nearY = bounded(anchorY, best.y, best.y + labelHeight);
    const displaced = Math.hypot(anchorX - nearX, anchorY - nearY) > 18;
    placed.push({...item, ...best, left:best.x, top:best.y, anchorX, anchorY,
      offsetX:best.x-anchorX, offsetY:best.y-anchorY, id, displaced,
      leader:displaced && (item.selected || item.fault) ? {from:[anchorX,anchorY], to:[nearX,nearY]} : null});
  }
  return placed;
}
