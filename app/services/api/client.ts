export function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE.replace(/\/$/, "");
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:8080/api/v1`;
  return "http://127.0.0.1:8080/api/v1";
}

export function apiAssetUrl(path?: string) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("blob:") || path.startsWith("data:")) return path;
  return `${apiBase().replace(/\/api\/v1$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public traceId?: string) { super(message); }
}

function cookie(name: string) {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((part) => part.startsWith(`${name}=`))?.split("=").slice(1).join("=") || "";
}

export async function api<T>(path: string, init: RequestInit = {}, csrfKind?: "admin" | "h5"): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfKind) {
    const value = decodeURIComponent(cookie(csrfKind === "admin" ? "ORDER_SHOW_ADMIN_CSRF" : "ORDER_SHOW_H5_CSRF"));
    if (value) headers.set("X-CSRF-Token", value);
  }
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: "include" });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  const errorBody = body as { code?: string; detail?: string; message?: string; traceId?: string } | null;
  const requestPath = path.split("?")[0];
  const requestMethod = (init.method || "GET").toUpperCase();
  const isReadRequest = requestMethod === "GET" || requestMethod === "HEAD";
  const lostReadAccess = isReadRequest && [401, 403].includes(response.status);
  const missingActivity = isReadRequest && response.status === 404 && /^\/admin\/activities\/\d+\/?$/.test(requestPath);
  if (!response.ok && typeof window !== "undefined" && path.startsWith("/admin/activities/")
      && (lostReadAccess || missingActivity)) {
    window.dispatchEvent(new Event("admin-access-invalid"));
  }
  if (!response.ok) throw new ApiError(response.status, errorBody?.code || "REQUEST_FAILED", errorBody?.detail || errorBody?.message || "请求失败", errorBody?.traceId);
  return body as T;
}
