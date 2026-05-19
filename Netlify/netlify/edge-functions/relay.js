const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

const NETLIFY_PREFIX = ["x-nf-", "x-netlify-"];

const NO_BODY = new Set(["GET", "HEAD"]);

const FALLBACK_URL = "https://amyraxvpn-main.github.io/AmyraxVPN-RELAY/";

function buildTargetUrl(xHost, pathname, search) {
  if (xHost.startsWith("http://") || xHost.startsWith("https://")) {
    return xHost + pathname + search;
  }
  const useHttps =
    !xHost.includes(":") ||
    xHost.includes(":443") ||
    /^s\d+\./.test(xHost);
  return (useHttps ? "https://" : "http://") + xHost + pathname + search;
}

function buildUpstreamHeaders(incoming) {
  const out = new Headers();
  let clientIp = null;

  for (const [name, value] of incoming) {
    const lower = name.toLowerCase();

    if (HOP_BY_HOP.has(lower)) continue;
    if (NETLIFY_PREFIX.some((p) => lower.startsWith(p))) continue;
    if (lower === "x-host") continue;

    if (lower === "x-real-ip") {
      clientIp = value;
      continue;
    }
    if (lower === "x-forwarded-for") {
      if (!clientIp) clientIp = value;
      continue;
    }

    out.set(lower, value);
  }

  if (clientIp) out.set("x-forwarded-for", clientIp);
  return out;
}

function buildDownstreamHeaders(upstream) {
  const out = new Headers();
  for (const [name, value] of upstream.headers) {
    if (name.toLowerCase() === "transfer-encoding") continue;
    out.set(name, value);
  }
  return out;
}

export default async function relay(request, _context) {
  try {
    const url = new URL(request.url);
    const xHost = request.headers.get("x-host");

    if (url.pathname === "/" && !xHost) {
      const isWebSocket =
        (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";

      if (!isWebSocket) {
        const page = await fetch(FALLBACK_URL);
        const html = await page.text();
        return new Response(html, {
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      }
    }

    if (!xHost) {
      return new Response("Bad Request: x-host header is required.", {
        status: 400,
      });
    }

    const targetUrl = buildTargetUrl(xHost, url.pathname, url.search);
    const outHeaders = buildUpstreamHeaders(request.headers);
    const method = request.method;

    let body = null;
    if (!NO_BODY.has(method) && request.body) {
      body = await request.arrayBuffer();
    }

    const upstream = await fetch(targetUrl, {
      method,
      headers: outHeaders,
      redirect: "manual",
      body,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: buildDownstreamHeaders(upstream),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return new Response(`Bad Gateway: ${msg}`, { status: 502 });
  }
}
