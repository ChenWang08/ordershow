export function validLiveRoomUrl(value?: string | null): string | null {
  const text = value?.trim();
  if (!text || text.length > 2048 || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? text : null;
  } catch { return null; }
}
