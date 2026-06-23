// api/metadata/[tokenId].js
// Re-export the parent handler so /api/metadata/:tokenId works via
// vercel.json rewrite. ESM default re-export.
export { default } from "../metadata.js";
