// Test scripts use the same finite HTTP JSON read as the public pages.
export async function readPublicActivity(apiBase, activityCode, { timeoutMs = 10_000 } = {}) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/public/activities/${encodeURIComponent(activityCode)}`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Activity HTTP returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.data?.code !== activityCode) throw new Error("Activity HTTP returned a different activity");
  return body.data;
}
