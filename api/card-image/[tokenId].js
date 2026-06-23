// api/card-image/[tokenId].js
// Re-export the parent handler so /api/card-image/:tokenId works via
// vercel.json rewrite. ESM default re-export.
export { default } from "../card-image.js";
