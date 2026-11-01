// Local release preparation: a read-only file manifest, at most two image requests at once.
import { readFile, writeFile } from "node:fs/promises";
const [manifest, output, base = "http://127.0.0.1:8080/api/v1"] = process.argv.slice(2);
if (!manifest || !output || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/api\/v1$/.test(base)) throw new Error("Provide a local manifest, output report and localhost API base.");
const files = (await readFile(manifest, "utf8")).replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean).map(line => {
  const [id, purpose, size] = line.split("\t"); return { id: Number(id), purpose, size: Number(size) };
});
const tasks = files.flatMap(file => ["thumbnail", ...(file.purpose === "LOTTERY_PRIZE_IMAGE" ? ["display"] : [])].map(kind => ({ ...file, kind })));
let next = 0, done = 0, bytes = 0, originalBytes = 0;
const failures = [], samples = [];
const started = Date.now();
const ready = await fetch(`${base}/actuator/health/readiness`, { signal: AbortSignal.timeout(10000) });
if (!ready.ok) throw new Error(`Local backend is not ready: HTTP ${ready.status}`);
await Promise.all([0, 1].map(async () => {
  while (next < tasks.length) {
    const task = tasks[next++];
    try {
      const response = await fetch(`${base}/public/files/${task.id}/${task.kind}?v=1`, { signal: AbortSignal.timeout(30000) });
      const data = await response.arrayBuffer();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (task.kind === "thumbnail") { bytes += data.byteLength; originalBytes += task.size; }
      if (samples.length < 3) samples.push({ id: task.id, originalBytes: task.size, bytes: data.byteLength, etag: response.headers.get("etag"), cacheControl: response.headers.get("cache-control") });
    } catch (error) { failures.push({ id: task.id, kind: task.kind, error: error.message }); }
    done++;
    if (done % 250 === 0) console.log(`Prepared ${done}/${tasks.length}`);
  }
}));
const report = { files: files.length, requests: tasks.length, successful: tasks.length - failures.length, seconds: (Date.now() - started) / 1000,
  originalBytes, thumbnailBytes: bytes, reductionPercent: originalBytes ? Math.round((1 - bytes / originalBytes) * 10000) / 100 : 0, samples, failures };
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, failures: failures.slice(0, 5), failureCount: failures.length }));
if (failures.length) process.exitCode = 1;
