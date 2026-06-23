// api/proxy-avatar.js
// Discord CDN proxy for the Collection Pack v5 cards.
//
// The pack-pool JSON references Discord CDN avatar URLs via the
//   /api/proxy-avatar?url=<encoded>
// pattern. Discord's CDN doesn't return Access-Control-Allow-Origin: *,
// so the browser canvas (drawImage) would otherwise fail. This endpoint
// fetches the upstream image, forwards it with permissive CORS headers,
// and re-encodes a few common raster formats. SVG is rejected to avoid
// potential script-injection vectors on user-supplied URLs.
//
// Notes on caching: the Vercel CDN caches by query string, so each unique
// Discord URL is fetched at most once per edge node. max-age is short
// because Discord CDN URLs include a hash that already changes when the
// user updates their avatar.

import { Readable } from "node:stream";

const ALLOWED_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "avatars.githubusercontent.com",
]);

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024; // 4 MB cap on avatar size

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, OPTIONS");
    return res.end("Method Not Allowed");
  }

  const raw = typeof req.query?.url === "string" ? req.query.url : "";
  if (!raw) {
    res.statusCode = 400;
    return res.end("Missing ?url=<encoded>");
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    res.statusCode = 400;
    return res.end("Invalid url");
  }

  if (target.protocol !== "https:") {
    res.statusCode = 400;
    return res.end("https only");
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    res.statusCode = 403;
    return res.end("host not allowed");
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "ritual-arena-proxy-avatar/1.0" },
    });
  } catch (err) {
    res.statusCode = 502;
    return res.end(`upstream fetch failed: ${err.message}`);
  }

  if (!upstream.ok || !upstream.body) {
    res.statusCode = upstream.status || 502;
    return res.end(`upstream error: ${upstream.statusText}`);
  }

  const contentType = upstream.headers.get("content-type") || "";
  // Reject anything that isn't a common image format (e.g. SVG, HTML).
  const baseType = contentType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(baseType)) {
    res.statusCode = 415;
    return res.end(`unsupported content-type: ${baseType || "unknown"}`);
  }

  // Stream the body, capping at MAX_UPSTREAM_BYTES to prevent abuse.
  res.setHeader("Content-Type", baseType);
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.setHeader("X-Proxied-From", target.hostname);
  res.statusCode = 200;

  let total = 0;
  const reader = upstream.body.getReader();
  const nodeStream = new Readable({
    async read() {
      try {
        const { value, done } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        total += value.byteLength;
        if (total > MAX_UPSTREAM_BYTES) {
          this.push(null);
          try { await reader.cancel(); } catch { /* ignore */ }
          res.end();
          return;
        }
        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err);
      }
    },
  });

  nodeStream.pipe(res);
};
