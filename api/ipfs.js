const PINATA_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function safeName(name) {
  return String(name || "ritual-upload").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("Request exceeds 12 MB limit.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) return json(res, 429, { error: "Rate limit exceeded. Try again shortly." });

  const jwt = process.env.PINATA_JWT;
  const allowedOrigin = process.env.IPFS_ALLOWED_ORIGIN;
  if (!jwt) return json(res, 503, { error: "IPFS proxy is not configured." });
  if (allowedOrigin && req.headers.origin !== allowedOrigin) return json(res, 403, { error: "Origin not allowed." });

  try {
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("application/json")) {
      const body = await readJson(req);

      if (body.type === "file") {
        if (!body.base64) return json(res, 400, { error: "Missing file data." });
        const bytes = Buffer.from(String(body.base64), "base64");
        if (bytes.length > 8 * 1024 * 1024) return json(res, 413, { error: "File exceeds 8 MB limit." });

        const blob = new Blob([bytes], { type: body.mimeType || "application/octet-stream" });
        const upstreamForm = new FormData();
        upstreamForm.append("file", blob, safeName(body.name));
        upstreamForm.append("pinataMetadata", JSON.stringify({ name: safeName(body.name) }));

        const upstream = await fetch(PINATA_FILE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
          body: upstreamForm,
        });
        const payload = await upstream.json().catch(() => ({}));
        if (!upstream.ok) return json(res, upstream.status, { error: payload.error || "Pinata file upload failed." });
        return json(res, 200, { uri: `ipfs://${payload.IpfsHash}`, IpfsHash: payload.IpfsHash });
      }

      if (body.type !== "json" || !body.data) return json(res, 400, { error: "Invalid JSON upload payload." });

      const upstream = await fetch(PINATA_JSON_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pinataMetadata: { name: safeName(body.name) },
          pinataContent: body.data,
        }),
      });
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return json(res, upstream.status, { error: payload.error || "Pinata JSON upload failed." });
      return json(res, 200, { uri: `ipfs://${payload.IpfsHash}`, IpfsHash: payload.IpfsHash });
    }

    return json(res, 400, { error: "Expected application/json." });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : "IPFS upload failed." });
  }
};
