// Smooth avoidance changes only. Projected vehicle anchors stay frame exact.
export function advanceLabelOffset(previous, placement, dt) {
  const x = Number(placement.offsetX ?? placement.x - placement.anchorX);
  const y = Number(placement.offsetY ?? placement.y - placement.anchorY);
  if (!previous || !Number.isFinite(previous.x) || !Number.isFinite(previous.y)) {
    return {x, y, moving:false};
  }
  const dx = x - previous.x, dy = y - previous.y;
  const distance = Math.hypot(dx, dy);
  if (distance < .04) return {x, y, moving:false};
  const seconds = Math.max(0, Math.min(.1, Number(dt) || 0));
  const alpha = Math.min(1 - Math.exp(-seconds / .12), seconds * 240 / distance);
  return {x:previous.x + dx * alpha, y:previous.y + dy * alpha, moving:true};
}

export function labelScreenPose(anchor, offset, placement, viewport, pixelRatio=1) {
  const ratio = Math.max(1, Number(pixelRatio) || 1);
  const clamp = (value, max) => Math.max(Math.ceil(8 * ratio) / ratio,
    Math.min(Math.floor(max * ratio) / ratio, value));
  const x = clamp(Math.round((anchor.x + offset.x) * ratio) / ratio,
    viewport.width - 8 - placement.width);
  const y = clamp(Math.round((anchor.y + offset.y) * ratio) / ratio,
    viewport.height - 8 - placement.height);
  const nearX = Math.max(x, Math.min(x + placement.width, anchor.x));
  const nearY = Math.max(y, Math.min(y + placement.height, anchor.y));
  return {x, y, nearX, nearY, leaderDistance:Math.hypot(anchor.x-nearX, anchor.y-nearY)};
}
