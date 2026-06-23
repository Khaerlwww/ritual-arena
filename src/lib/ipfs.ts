// Minimal IPFS upload client. The browser must never receive a Pinata JWT;
// VITE_IPFS_UPLOAD_URL should point at a tiny server/edge proxy that holds the
// secret and returns either { uri: "ipfs://..." } or { IpfsHash: "..." }.
//
// When the endpoint is unavailable (404, network error, etc.), the client
// signals this so the forge flow can fall back to inline data-URI metadata
// instead of blocking the user.

const UPLOAD_URL = import.meta.env.VITE_IPFS_UPLOAD_URL as string | undefined;
const USE_BUILT_IN_PROXY =
  UPLOAD_URL === "/api/ipfs" || UPLOAD_URL?.endsWith("/api/ipfs");
const GATEWAYS = (
  (import.meta.env.VITE_IPFS_GATEWAYS || import.meta.env.VITE_IPFS_GATEWAY) as
    | string
    | undefined
)
  ?.split(",")
  .map((g) => g.trim())
  .filter(Boolean) ?? [
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://ipfs.io/ipfs/",
];

export const hasPinata = Boolean(UPLOAD_URL);
const MAX_RETRIES = 3;

// Probe whether the upload endpoint is reachable.
// Returns true if the endpoint responds successfully to a HEAD/GET probe.
let _endpointAvailable: boolean | null = null;

export async function probeEndpoint(): Promise<boolean> {
  if (!UPLOAD_URL) {
    _endpointAvailable = false;
    return false;
  }
  if (_endpointAvailable !== null) return _endpointAvailable;

  try {
    // Try a lightweight HEAD request first
    const res = await fetch(UPLOAD_URL, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    // 405 Method Not Allowed is fine — endpoint exists, just doesn't support HEAD
    _endpointAvailable = res.ok || res.status === 405;
  } catch {
    // Network error, timeout, CORS block — endpoint is unreachable
    _endpointAvailable = false;
  }
  return _endpointAvailable;
}

// Reset probe cache (useful after config changes)
export function resetProbeCache() {
  _endpointAvailable = null;
}

async function readError(res: Response) {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}

async function parseUploadResponse(res: Response) {
  if (!res.ok) {
    const body = await readError(res);
    throw new Error(`IPFS upload failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { uri?: string; IpfsHash?: string; cid?: string };
  if (json.uri?.startsWith("ipfs://")) return json.uri;
  const cid = json.IpfsHash || json.cid;
  if (cid) return `ipfs://${cid}`;
  throw new Error("IPFS upload response missing CID");
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || attempt === retries) return res;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("All retries exhausted");
}

async function blobToBase64(file: Blob) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Pin a binary blob (image/audio) and return its ipfs:// URI. */
export async function pinFile(file: Blob, name: string): Promise<string> {
  if (!UPLOAD_URL) throw new Error("VITE_IPFS_UPLOAD_URL not set");

  // Probe endpoint first — if unreachable, throw a specific error
  const available = await probeEndpoint();
  if (!available) {
    throw new Error("IPFS_UPLOAD_UNAVAILABLE");
  }

  if (USE_BUILT_IN_PROXY) {
    const res = await fetchWithRetry(UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "file",
        name,
        mimeType: file.type,
        base64: await blobToBase64(file),
      }),
    });
    return parseUploadResponse(res);
  }

  const form = new FormData();
  form.append("type", "file");
  form.append("file", file, name);
  form.append("name", name);

  const res = await fetchWithRetry(UPLOAD_URL, {
    method: "POST",
    body: form,
  });
  return parseUploadResponse(res);
}

/** Pin a JSON object (metadata) and return its ipfs:// URI. */
export async function pinJson(data: unknown, name: string): Promise<string> {
  if (!UPLOAD_URL) throw new Error("VITE_IPFS_UPLOAD_URL not set");

  const available = await probeEndpoint();
  if (!available) {
    throw new Error("IPFS_UPLOAD_UNAVAILABLE");
  }

  const res = await fetchWithRetry(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "json", name, data }),
  });
  return parseUploadResponse(res);
}

/** Convert an ipfs:// URI to an HTTP gateway URL for previewing. */
export function ipfsToHttp(uri: string) {
  if (!uri.startsWith("ipfs://")) return uri;
  return GATEWAYS[0].replace(/\/$/, "") + "/" + uri.slice("ipfs://".length);
}

export async function ipfsToHttpWithFallback(uri: string): Promise<string> {
  if (!uri.startsWith("ipfs://")) return uri;
  const cid = uri.slice("ipfs://".length);
  for (const gateway of GATEWAYS) {
    const url = gateway.replace(/\/$/, "") + "/" + cid;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch {
      // Try the next configured gateway.
    }
  }
  return GATEWAYS[0].replace(/\/$/, "") + "/" + cid;
}
