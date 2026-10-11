export function initialWindowBounds(area: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(area.width, Math.max(640, Math.min(1440, Math.round(area.width * 0.9))));
  const height = Math.min(area.height, Math.max(480, Math.min(920, Math.round(area.height * 0.9))));
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
    minWidth: Math.min(840, width),
    minHeight: Math.min(580, height),
  };
}
