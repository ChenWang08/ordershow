export function memoryStorage() {
  const values = new Map(), writes = [];
  return { values, writes,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes.push(["set", key, value]); },
    removeItem: key => { values.delete(key); writes.push(["remove", key]); },
  };
}
