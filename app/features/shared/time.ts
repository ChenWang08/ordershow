/** API instants are UTC; business forms and displays always use Beijing time. */
export const BEIJING_TIME_ZONE = "Asia/Shanghai";
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function instantMillis(value: string) {
  const normalized = value.trim().replace(" ", "T");
  // Legacy unzoned API values follow the same UTC contract as database DATETIME.
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
}

export function formatBeijingTime(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (value == null) return "—";
  const date = typeof value === "string" ? new Date(instantMillis(value)) : value;
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false, ...options, timeZone: BEIJING_TIME_ZONE });
}

export function toBeijingDateTimeLocal(value: string) {
  const date = new Date(instantMillis(value) + BEIJING_OFFSET_MS);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

/** Parse datetime-local as Beijing time, independently of the browser's timezone. */
export function beijingDateTimeMillis(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second = "0", fraction = "0"] = match;
  const parts = [+year, +month, +day, +hour, +minute, +second, +fraction.padEnd(3, "0")];
  const wall = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], parts[6]));
  if (wall.getUTCFullYear() !== parts[0] || wall.getUTCMonth() + 1 !== parts[1] || wall.getUTCDate() !== parts[2]
      || wall.getUTCHours() !== parts[3] || wall.getUTCMinutes() !== parts[4] || wall.getUTCSeconds() !== parts[5]) return NaN;
  return wall.getTime() - BEIJING_OFFSET_MS;
}

export function beijingDateTimeToUtc(value: string) {
  const timestamp = beijingDateTimeMillis(value);
  if (!Number.isFinite(timestamp)) throw new RangeError("请填写有效的北京时间");
  return new Date(timestamp).toISOString();
}

export function beijingDateStamp(value: Date = new Date()) {
  return new Date(value.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}
