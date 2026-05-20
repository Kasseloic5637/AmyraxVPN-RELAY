const EXCLUDED_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded", "x-forwarded-host", "x-forwarded-proto",
  "x-forwarded-port", "x-host", "cf-connecting-ip", "cf-ray"
]);

const FALLBACK_SITE = "https://amyraxvpn-main.github.io/AmyraxVPN-RELAY/";

export default async function edgeRouter(request) {
  try {
    const requestUrl = new URL(request.url);
    const targetHost = request.headers.get("x-host");

    if (!targetHost) {
      if (requestUrl.pathname === "/") {
        const isWebSocket = (request.headers.get("upgrade") || "").toLowerCase() === "websocket";
        if (!isWebSocket) {
          return fetch(FALLBACK_SITE);
        }
      }
      return new Response("Not Found", { status: 404 });
    }

    let protocol = "https://";
    let cleanHost = targetHost;

    if (targetHost.startsWith("http://")) {
      protocol = "http://";
      cleanHost = targetHost.replace("http://", "");
    } else if (targetHost.startsWith("https://")) {
      cleanHost = targetHost.replace("https://", "");
    } else if (targetHost.includes(":") && !targetHost.includes(":443") && !/^s\d+\./.test(targetHost)) {
      protocol = "http://";
    }
    
    const finalTarget = new URL(requestUrl.pathname + requestUrl.search, protocol + cleanHost);

    const proxyHeaders = new Headers();
    let clientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");

    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase();
      
      if (EXCLUDED_HEADERS.has(lowerKey)) continue;
      if (lowerKey.startsWith("x-nf-") || lowerKey.startsWith("x-netlify-")) continue;
      
      proxyHeaders.set(key, value);
    }

    if (clientIp) proxyHeaders.set("x-forwarded-for", clientIp);

    const reqMethod = request.method;
    const isBodyAllowed = reqMethod !== "GET" && reqMethod !== "HEAD";
    const hasStream = isBodyAllowed && request.body !== null;

    const fetchOptions = {
      method: reqMethod,
      headers: proxyHeaders,
      redirect: "manual",
    };

    if (hasStream) {
      fetchOptions.body = request.body;
      fetchOptions.duplex = "half";
    }

    const upstreamRes = await fetch(finalTarget.toString(), fetchOptions);

    const finalHeaders = new Headers(upstreamRes.headers);
    finalHeaders.delete("transfer-encoding");
    finalHeaders.delete("content-encoding");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: finalHeaders,
    });

  } catch (error) {
    return new Response("Edge Runtime Error", { status: 500 });
  }
}

export const config = {
  path: "/*"
};
