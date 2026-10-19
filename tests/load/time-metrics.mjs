// Never clamp a future event to zero: a timezone or clock mismatch must fail the measurement.
export function notificationAgeMs(occurredAt, observedAt = Date.now()) {
  const start = typeof occurredAt === "string" ? Date.parse(occurredAt) : occurredAt;
  const age = observedAt - start;
  if (!Number.isFinite(start) || !Number.isFinite(observedAt) || age < 0) {
    throw new Error("Invalid or negative notification age: check event timezones and clock synchronization");
  }
  return age;
}
