import { Elysia } from "elysia";
import * as jose from "jose";
import { verifyBearerUser } from "./auth";

const GRAFANA_INTERNAL_URL = (process.env.GRAFANA_INTERNAL_URL ?? "http://grafana:3000").replace(/\/$/, "");
const JWT_SECRET = process.env.JWT_SECRET ?? "watermelon-dev-secret-change-in-prod";
const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);
const COOKIE_NAME = "wm_grafana";
const PUBLIC_PATH = "/api/admin/observability";
const API_PATH = "/admin/observability";
const isProd = process.env.NODE_ENV === "production";

export const GRAFANA_DASHBOARDS = [
  { uid: "wm-business", title: "Бизнес", slug: "business" },
  { uid: "wm-infrastructure", title: "Инфраструктура", slug: "infrastructure" },
  { uid: "wm-api", title: "API", slug: "api" },
] as const;

async function signGrafanaCookie(adminId: string, username: string): Promise<string> {
  return new jose.SignJWT({ purpose: "grafana", username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(JWT_SECRET_BYTES);
}

async function verifyGrafanaCookie(token: string): Promise<{ adminId: string; username: string } | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET_BYTES);
    if (payload.purpose !== "grafana" || typeof payload.sub !== "string") return null;
    const username = typeof payload.username === "string" ? payload.username : "admin";
    return { adminId: payload.sub, username };
  } catch {
    return null;
  }
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

async function resolveGrafanaAdmin(request: Request): Promise<{ adminId: string; username: string } | null> {
  const bearer = await verifyBearerUser(request);
  if (bearer?.isAdmin) {
    return { adminId: bearer.id, username: bearer.username };
  }
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifyGrafanaCookie(token);
}

function grafanaTargetPath(requestUrl: string): string {
  const u = new URL(requestUrl);
  const prefixes = ["/admin/observability", "/api/admin/observability"];
  let path = u.pathname;
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length) || "/";
      break;
    }
  }
  return `${path}${u.search}`;
}

function rewriteProxyResponse(res: Response, publicPrefix: string): Response {
  const headers = new Headers(res.headers);
  const location = headers.get("location");
  if (location) {
    try {
      const loc = new URL(location, GRAFANA_INTERNAL_URL);
      if (loc.origin === new URL(GRAFANA_INTERNAL_URL).origin) {
        headers.set("location", `${publicPrefix}${loc.pathname}${loc.search}`);
      }
    } catch {
      // keep original
    }
  }
  headers.delete("content-security-policy");
  headers.delete("x-frame-options");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function proxyToGrafana(request: Request, admin: { username: string }): Promise<Response> {
  const targetPath = grafanaTargetPath(request.url);
  const target = `${GRAFANA_INTERNAL_URL}${targetPath}`;
  const headers = new Headers();
  headers.set("X-Watermelon-Admin", admin.username);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const method = request.method;
  const body =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS" ? await request.arrayBuffer() : undefined;

  let res: Response;
  try {
    res = await fetch(target, { method, headers, body, redirect: "manual" });
  } catch (err) {
    console.warn("[Grafana proxy]", err);
    return new Response("Grafana unavailable", { status: 503 });
  }

  const publicPrefix = new URL(request.url).origin + PUBLIC_PATH;
  return rewriteProxyResponse(res, publicPrefix);
}

async function requireAdminProxy(request: Request, set: { status?: number | string }): Promise<{ username: string } | null> {
  const admin = await resolveGrafanaAdmin(request);
  if (!admin) {
    set.status = 403;
    return null;
  }
  return { username: admin.username };
}

export const adminObservabilityRoutes = new Elysia({ prefix: "/admin/observability" })
  .get("/dashboards", async ({ request, set }) => {
    const admin = await verifyBearerUser(request);
    if (!admin?.isAdmin) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    return {
      dashboards: GRAFANA_DASHBOARDS.map((d) => ({
        uid: d.uid,
        title: d.title,
        embedPath: `${API_PATH}/d/${d.uid}/${d.slug}?orgId=1&theme=dark&kiosk&from=now-24h&to=now&refresh=30s`,
      })),
    };
  })
  .post("/session", async ({ request, set }) => {
    const admin = await verifyBearerUser(request);
    if (!admin?.isAdmin) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    const token = await signGrafanaCookie(admin.id, admin.username);
    const secure = isProd ? "; Secure" : "";
    set.headers["set-cookie"] =
      `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=${PUBLIC_PATH}; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`;
    return { ok: true };
  })
  .all("/", async ({ request, set }) => {
    const admin = await requireAdminProxy(request, set);
    if (!admin) return { error: "Forbidden" };
    return proxyToGrafana(request, admin);
  })
  .all("/*", async ({ request, set }) => {
    const admin = await requireAdminProxy(request, set);
    if (!admin) return { error: "Forbidden" };
    return proxyToGrafana(request, admin);
  });
