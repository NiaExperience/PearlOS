// Server-side health check API route — avoids CORS issues with direct browser fetches
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface ServiceCheck {
  name: string;
  url: string;
  fallbackUrls?: string[];
  method: string;
  headers?: Record<string, string>;
  body?: string;
  /** Accept any 2xx or these specific codes as "up" */
  acceptCodes?: number[];
}

interface PageCheck {
  name: string;
  path: string;
  acceptCodes: number[];
}

const SERVICES: ServiceCheck[] = [
  {
    name: "OpenClaw Gateway",
    url: "http://localhost:18789/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.OPENCLAW_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENCLAW_API_KEY}` }
        : {}),
    },
    body: "{}",
    // 400/401 both mean the OpenAI-compatible gateway route is alive.
    acceptCodes: [200, 400, 401],
  },
  {
    name: "Mesh GraphQL",
    url: "http://localhost:2000/graphql",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{__typename}" }),
    // Mesh returns 401 when auth is required but service is up
    acceptCodes: [200, 401],
  },
  {
    name: "Bot Gateway",
    url: "http://localhost:4444/health",
    method: "GET",
  },
  {
    name: "PocketTTS",
    url: "http://localhost:8766/health",
    fallbackUrls: ["http://localhost:8766/healthz"],
    method: "GET",
  },
];

const DEFAULT_REQUIRED_PAGES: PageCheck[] = [
  { name: "Login", path: "/login", acceptCodes: [200] },
  { name: "Signup", path: "/signup", acceptCodes: [200] },
  { name: "Recovery", path: "/recovery", acceptCodes: [200] },
  { name: "The Agency", path: "/the-agency", acceptCodes: [200] },
  { name: "PearlOS Home", path: "/pearlos", acceptCodes: [200, 302, 307, 308] },
  { name: "Notes", path: "/pearlos/notes", acceptCodes: [200, 302, 307, 308] },
  { name: "Launchpad", path: "/pearlos/launchpad", acceptCodes: [200, 302, 307, 308] },
  { name: "Settings", path: "/pearlos/settings", acceptCodes: [200, 302, 307, 308] },
];

function getRequiredPages(): PageCheck[] {
  const configuredPaths = process.env.PEARLOS_REQUIRED_PAGE_PATHS
    ?.split(",")
    .map((path) => path.trim())
    .filter(Boolean);

  if (!configuredPaths?.length) {
    return DEFAULT_REQUIRED_PAGES;
  }

  return configuredPaths.map((path) => ({
    name: path,
    path: path.startsWith("/") ? path : `/${path}`,
    acceptCodes: [200, 302, 307, 308],
  }));
}

async function checkServiceUrl(svc: ServiceCheck, url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: svc.method,
      headers: svc.headers,
      body: svc.body,
      signal: controller.signal,
    });
    const ok =
      (res.status >= 200 && res.status < 300) ||
      (svc.acceptCodes?.includes(res.status) ?? false);
    return { name: svc.name, status: ok ? "up" : "down", code: res.status };
  } catch (e: any) {
    return { name: svc.name, status: "down" as const, error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkService(svc: ServiceCheck) {
  const urls = [svc.url, ...(svc.fallbackUrls ?? [])];
  let lastResult: Awaited<ReturnType<typeof checkServiceUrl>> | null = null;

  for (const url of urls) {
    const result = await checkServiceUrl(svc, url);
    if (result.status === "up") return result;
    lastResult = result;
  }

  return lastResult ?? { name: svc.name, status: "down" as const, error: "No health check URL configured" };
}

async function checkPage(baseUrl: string, page: PageCheck) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const url = new URL(page.path, baseUrl);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "interface-required-page-healthcheck/1.0",
      },
    });
    const ok = page.acceptCodes.includes(res.status);
    return { name: page.name, path: page.path, status: ok ? "up" : "down", code: res.status };
  } catch (e: any) {
    return { name: page.name, path: page.path, status: "down" as const, error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? "localhost:3000";
  const proto = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const [services, pages] = await Promise.all([
    Promise.all(SERVICES.map(checkService)),
    Promise.all(getRequiredPages().map((page) => checkPage(getBaseUrl(request), page))),
  ]);
  const status = services.every((svc) => svc.status === "up") && pages.every((page) => page.status === "up")
    ? "up"
    : "degraded";

  return NextResponse.json({ ts: Date.now(), status, services, pages });
}
