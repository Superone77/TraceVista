export function chatBounds(workspaceWidth: number, floating: boolean, storyVisible: boolean) {
  const max = Math.max(1, Math.floor(workspaceWidth - (floating ? 24 : 240 + (storyVisible ? 280 : 0))));
  return { min: Math.min(320, max), max };
}

export function clampChatWidth(width: number, bounds: { min: number; max: number }, fallback: number) {
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, Number.isFinite(width) && width > 0 ? width : fallback)));
}
