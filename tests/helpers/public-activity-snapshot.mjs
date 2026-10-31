// Test scripts read the same initial SSE snapshot as the real frontend, then close the connection.
export async function readPublicActivity(apiBase, activityCode, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  let reader;
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/public/activities/${encodeURIComponent(activityCode)}/events`, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!response.ok) throw new Error(`Activity SSE returned HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new Error("Activity SSE returned an unexpected content type");
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Activity SSE ended before its initial snapshot");
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const lines = buffer.slice(0, end).split("\n");
        buffer = buffer.slice(end + 2);
        const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        if (event !== "activity" && event !== "unavailable") continue;
        const data = JSON.parse(lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n"));
        if (event === "unavailable") throw new Error(`Activity SSE unavailable: ${data.code}`);
        if (data.activity?.code !== activityCode) throw new Error("Activity SSE returned a different activity");
        return data.activity;
      }
    }
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
