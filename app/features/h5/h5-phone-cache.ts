type PhoneStorage = Pick<Storage, "getItem" | "setItem">;

export function h5PhoneCacheKey(activityCode: string) {
  return `order-show:h5-phone:v1:${encodeURIComponent(activityCode.trim())}`;
}

export function createH5PhoneCache(storage: () => PhoneStorage | undefined) {
  const memory = new Map<string, string>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    read(activityCode: string) {
      if (!activityCode.trim()) return "";
      const key = h5PhoneCacheKey(activityCode);
      if (!pending.has(key)) {
        try {
          const target = storage();
          if (target) {
            const value = target.getItem(key) ?? "";
            memory.set(key, /^1\d{10}$/.test(value) ? value : "");
          }
        } catch { /* Keep the last known number if browser storage becomes unavailable. */ }
      }
      return memory.get(key) ?? "";
    },
    save(activityCode: string, phone: string) {
      if (!activityCode.trim() || !/^1\d{10}$/.test(phone)) return;
      const key = h5PhoneCacheKey(activityCode);
      memory.set(key, phone);
      pending.add(key);
      try {
        const target = storage();
        if (target) {
          target.setItem(key, phone);
          pending.delete(key);
        }
      } catch { /* The current page can still remember a successfully verified number. */ }
      listeners.forEach(listener => listener());
    },
  };
}
