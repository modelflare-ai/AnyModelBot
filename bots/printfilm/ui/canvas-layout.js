export const CANVAS = { width: 1400, height: 900 };
export const limitZoom = (value) => Math.max(0.15, Math.min(1.5, value));
export const fitCanvas = (width, height) => limitZoom(Math.min(1, width / CANVAS.width, height / CANVAS.height));
export function dragPosition(origin, dx, dy, scale) {
  return {
    x: Math.max(0, Math.min(1200, origin.x + dx / scale)),
    y: Math.max(0, Math.min(800, origin.y + dy / scale)),
  };
}
