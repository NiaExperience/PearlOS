import { NextRequest } from "next/server";

import { GET } from "../route";

const originalFetch = global.fetch;

function request() {
  return new NextRequest("https://app.pearlos.org/api/health", {
    headers: {
      host: "app.pearlos.org",
      "x-forwarded-proto": "https",
    },
  });
}

describe("/api/health", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.PEARLOS_REQUIRED_PAGE_PATHS;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("checks configured required pages alongside backend services", async () => {
    process.env.PEARLOS_REQUIRED_PAGE_PATHS = "/login,/recovery";
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://app.pearlos.org/login" || url === "https://app.pearlos.org/recovery") {
        return new Response("ok", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }) as any;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("up");
    expect(body.pages).toEqual([
      expect.objectContaining({ path: "/login", status: "up", code: 200 }),
      expect.objectContaining({ path: "/recovery", status: "up", code: 200 }),
    ]);
  });

  it("falls back to PocketTTS /healthz when /health is unavailable", async () => {
    process.env.PEARLOS_REQUIRED_PAGE_PATHS = "/login";
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8766/health") {
        return new Response("missing", { status: 404 });
      }
      return new Response("ok", { status: 200 });
    }) as any;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("up");
    expect(body.services).toContainEqual(
      expect.objectContaining({ name: "PocketTTS", status: "up", code: 200 }),
    );
  });

  it("marks health degraded when a required page returns a server error", async () => {
    process.env.PEARLOS_REQUIRED_PAGE_PATHS = "/login,/recovery";
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://app.pearlos.org/recovery") {
        return new Response("error", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    }) as any;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.pages).toContainEqual(
      expect.objectContaining({ path: "/recovery", status: "down", code: 500 }),
    );
  });
});
