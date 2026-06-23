import { avatarUrl, classAbility, SEASON, type Anthem } from "./anthem";
import { RARITY_BADGE, getRarityPreset, nftSerial, type RarityPreset } from "./rarity";
import {
  getVisualEvolutionUnlocks,
  type VisualEvolutionUnlocks,
} from "./visualEvolution";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeout = window.setTimeout(() => reject(new Error("avatar load timed out")), 2500);
    img.crossOrigin = "anonymous"; // unavatar returns Access-Control-Allow-Origin: *
    img.onload = () => {
      window.clearTimeout(timeout);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("avatar load failed"));
    };
    img.src = src;
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Deterministic PRNG (mulberry32) — keeps particles/foil identical per seed. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAINBOW = ["#ff2e63", "#ff9a00", "#ffe600", "#36ff6a", "#00e0ff", "#7a5cff", "#ff00d4"];
const SILVER = ["#f4f7f8", "#aab3b8", "#e8edf0", "#8a9296", "#dfe6e9"];
const RITUAL_MARK_PATH =
  "M30.4227 108.445L40.6803 98.1203L48.5666 106.058L30.0682 124.677L0.70482 95.1222L30.0678 65.5677L70.0435 105.804L62.1576 113.741L30.4227 81.7994L30.068 81.4424L29.7133 81.7994L16.827 94.7696L16.4768 95.122L16.827 95.4744L29.7133 108.445L30.068 108.802L30.4227 108.445ZM73.0227 22.3335L112.998 62.5693L105.112 70.5069L73.3773 38.5655L73.0226 38.2085L72.6679 38.5655L59.7815 51.5358L59.4314 51.8882L59.7815 52.2406L70.0437 62.5695L62.1578 70.5068L43.6594 51.888L73.0227 22.3335ZM76.0015 127.675L83.8871 119.738L115.622 151.68L115.977 152.037L116.331 151.68L129.218 138.709L129.568 138.357L129.218 138.005L118.956 127.676L126.842 119.738L145.341 138.356L115.977 167.911L76.0015 127.675ZM126.842 76.5037L158.577 108.445L158.932 108.802L159.287 108.445L172.173 95.4749L172.523 95.1225L172.173 94.7701L159.287 81.7999L158.932 81.4429L158.577 81.7999L148.32 92.1242L140.433 84.1866L158.932 65.5679L188.295 95.1223L158.932 124.677L118.956 84.441L126.842 76.5037ZM73.3773 151.679L83.6349 141.354L91.5211 149.292L73.0227 167.911L43.6594 138.356L83.6347 98.1201L91.521 106.058L59.7815 138.004L59.4314 138.356L59.7815 138.709L72.6679 151.679L73.0226 152.036L73.3773 151.679ZM105.368 92.12L97.4825 84.1828L129.222 52.2368L129.572 51.8844L129.222 51.5319L116.336 38.5617L115.981 38.2047L115.626 38.5617L105.369 48.8861L97.4826 40.9488L115.981 22.3297L145.344 51.8842L105.368 92.12ZM91.5208 62.8237L62.4101 92.1239L54.5242 84.1866L83.6349 54.8865L91.5208 62.8237ZM76.0017 84.4408L83.8876 76.5036L112.998 105.804L105.112 113.741L76.0017 84.4408ZM97.4786 127.421L126.589 98.1205L134.476 106.058L105.365 135.358L97.4786 127.421ZM94.669 30.6567L79.7922 15.683L94.669 0.709411L109.546 15.683L94.669 30.6567ZM94.6691 188.291L79.7923 173.317L94.6691 158.343L109.546 173.317L94.6691 188.291Z";
const GOLD = ["#fff3b0", "#f5c542", "#fff8d6", "#b8860b", "#ffd76a"];

function applyStops(grad: CanvasGradient, colors: string[]) {
  colors.forEach((c, i) => grad.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
  return grad;
}

/** Color used for glow/shadow per rarity border. */
function glowColor(preset: RarityPreset, accent: string) {
  switch (preset.borderType) {
    case "gold-chrome":
      return "#ffd76a";
    case "rainbow":
    case "holographic":
    case "prism":
    case "black-chrome-prism":
      return "#9b8cff";
    default:
      return accent;
  }
}

/** Stroke style for the card frame, by rarity border type. */
function borderStroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  preset: RarityPreset,
): CanvasGradient {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (preset.borderType) {
    case "silver":
      return applyStops(ctx.createLinearGradient(x, y, x + w, y + h), SILVER);
    case "gold-chrome":
      return applyStops(ctx.createLinearGradient(x, y, x + w, y + h), GOLD);
    case "rainbow":
      return applyStops(ctx.createLinearGradient(x, y, x + w, y), RAINBOW);
    case "holographic":
    case "prism":
    case "black-chrome-prism":
      if (ctx.createConicGradient) {
        return applyStops(ctx.createConicGradient(0, cx, cy), [...RAINBOW, RAINBOW[0]]);
      }
      return applyStops(ctx.createLinearGradient(x, y, x + w, y + h), [...RAINBOW, RAINBOW[0]]);
    default:
      return applyStops(ctx.createLinearGradient(x, y, x + w, y + h), SILVER);
  }
}

/** Background wash whose opacity scales with backgroundIntensity. */
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, anthem: Anthem, preset: RarityPreset) {
  const [g0, g1, g2] = anthem.gradient ?? ["#7fe3d2", "#48a89a", "#063a33"];
  ctx.fillStyle = "#071512";
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, g0);
  grad.addColorStop(0.5, g1);
  grad.addColorStop(1, g2);
  ctx.save();
  ctx.globalAlpha = 0.22 + (preset.backgroundIntensity / 100) * 0.5;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Radial vignette glow behind the portrait, brighter for richer backgrounds.
  const rg = ctx.createRadialGradient(W / 2, 330, 40, W / 2, 330, 540);
  rg.addColorStop(0, `rgba(255,255,255,${0.1 + (preset.backgroundIntensity / 100) * 0.16})`);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  drawRitualGlyph(ctx, W / 2, H / 2, 540, 0.045, false);
}

/** Deterministic sparkle field; density scales with particleDensity. */
function drawParticles(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  preset: RarityPreset,
  accent: string,
  rng: () => number,
) {
  const n = Math.round((preset.particleDensity / 100) * 90);
  if (n <= 0) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const px = rng() * W;
    const py = rng() * H;
    const r = 0.8 + rng() * 2.6;
    ctx.globalAlpha = 0.2 + rng() * 0.55;
    ctx.fillStyle = rng() > 0.55 ? "#ffffff" : accent;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    // A few cross-shaped twinkles for high-rarity cosmic fields.
    if (preset.particleDensity >= 60 && rng() > 0.9) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 5, py);
      ctx.lineTo(px + 5, py);
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px, py + 5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Holographic foil sheen; opacity + number of bands scale with foilCoverage. */
function drawFoil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  preset: RarityPreset,
  rng: () => number,
) {
  if (preset.foilCoverage <= 0) return;
  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";

  // Base diagonal rainbow wash.
  const wash = applyStops(ctx.createLinearGradient(x, y, x + w, y + h), RAINBOW);
  ctx.globalAlpha = (preset.foilCoverage / 100) * 0.34;
  ctx.fillStyle = wash;
  ctx.fillRect(x, y, w, h);

  // Diagonal shine streaks — more streaks for higher coverage.
  const streaks = Math.round((preset.foilCoverage / 100) * 6);
  for (let i = 0; i < streaks; i++) {
    const offset = (rng() - 0.5) * w;
    const grad = ctx.createLinearGradient(x + offset, y, x + offset + 160, y + h);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, `rgba(255,255,255,${0.06 + (preset.foilCoverage / 100) * 0.12})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/** Card frame with metallic/rainbow stroke + glow + corner accents. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  preset: RarityPreset,
  accent: string,
) {
  ctx.save();
  ctx.shadowColor = glowColor(preset, accent);
  ctx.shadowBlur = (preset.glowIntensity / 100) * 38;

  // GENESIS / black-chrome: thick black base ring first.
  if (preset.borderType === "black-chrome-prism") {
    ctx.lineWidth = 22 + preset.frameComplexity * 2;
    ctx.strokeStyle = "#0a0a0a";
    roundedRect(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  ctx.lineWidth = 8 + preset.frameComplexity * 2.5;
  ctx.strokeStyle = borderStroke(ctx, x, y, w, h, preset);
  roundedRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner hairline for added depth on more complex frames.
  if (preset.frameComplexity >= 3) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    roundedRect(ctx, x + 14, y + 14, w - 28, h - 28, r - 8);
    ctx.stroke();
  }

  // Corner brackets — count/length grow with frame complexity.
  if (preset.frameComplexity >= 2) {
    const len = 26 + preset.frameComplexity * 6;
    ctx.lineWidth = 3;
    ctx.strokeStyle = preset.borderType === "gold-chrome" ? "#ffe9a8" : "#ffffff";
    ctx.globalAlpha = 0.8;
    const corners: [number, number, number, number][] = [
      [x + 8, y + 8, 1, 1],
      [x + w - 8, y + 8, -1, 1],
      [x + 8, y + h - 8, 1, -1],
      [x + w - 8, y + h - 8, -1, -1],
    ];
    for (const [px, py, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(px, py + sy * len);
      ctx.lineTo(px, py);
      ctx.lineTo(px + sx * len, py);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRitualGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  alpha = 1,
  glow = true,
) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 189, size / 189);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#f7fbfa";
  if (glow) {
    ctx.shadowColor = "rgba(255,255,255,0.72)";
    ctx.shadowBlur = 10;
  }

  const mark = new Path2D(RITUAL_MARK_PATH);
  ctx.fill(mark);

  ctx.globalCompositeOperation = "screen";
  const shine = ctx.createLinearGradient(0, 0, 189, 189);
  shine.addColorStop(0, "rgba(255,255,255,0)");
  shine.addColorStop(0.48, "rgba(255,255,255,0.32)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fill(mark);
  ctx.restore();
}

/** Small white Ritual glyph + wordmark for the header (top-left). */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string) {
  ctx.save();
  drawRitualGlyph(ctx, x + 17, y, 40, 0.92, true);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cdd6d3";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.fillText("RITUAL ARENA", x + 46, y + 1);
  ctx.restore();
}

/** Grade badge (label + stars + tag) for the header (top-right). */
function drawRarityBadge(ctx: CanvasRenderingContext2D, rightX: number, y: number, anthem: Anthem, preset: RarityPreset) {
  const badge = RARITY_BADGE[anthem.rarity];
  const color = preset.borderType === "gold-chrome" ? "#ffd76a" : preset.borderType === "silver" ? "#dfe6e9" : "#b9a9ff";
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = (preset.glowIntensity / 100) * 24;
  ctx.fillStyle = color;
  ctx.font = "bold 30px Arial, sans-serif";
  ctx.fillText(anthem.rarity, rightX, y - 8);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffd76a";
  ctx.font = "18px Arial, sans-serif";
  const maxStars = Math.max(5, badge.stars);
  ctx.fillText("★".repeat(badge.stars) + "☆".repeat(maxStars - badge.stars), rightX, y + 16);
  ctx.fillStyle = "#9fb0ab";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText(badge.tag, rightX, y + 36);
  ctx.restore();
}

function drawIdentityRankBadge(ctx: CanvasRenderingContext2D, x: number, y: number, identityRank?: string) {
  const tier = (identityRank || "").toUpperCase();
  if (tier !== "RADIANT RITUALIST" && tier !== "RITUALIST") return;
  const color = tier === "RADIANT RITUALIST" ? "#ffd76a" : "#c9b8ff";
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(2,8,7,0.72)";
  roundedRect(ctx, x, y, 230, 54, 12);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, 230, 54, 12);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(232,239,238,0.72)";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText("IDENTITY RANK", x + 16, y + 21);
  ctx.fillStyle = color;
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.fillText(tier, x + 16, y + 44);
  ctx.restore();
}

/**
 * Static (SVG-like) render of the Visual Evolution Roadmap effects.
 * Mirrors the live UI render so the metadata image reflects the same
 * unlocked state at any training level. Pure canvas — no animation.
 */
function drawVisualEvolutionEffects(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  unlocks: VisualEvolutionUnlocks,
) {
  if (
    !unlocks.iceFrame &&
    !unlocks.animatedBackground &&
    !unlocks.holographicLayer &&
    !unlocks.rareBorder &&
    !unlocks.ritualOgBadge &&
    !unlocks.prismAura
  ) return;

  ctx.save();

  // Level 4 — Animated Background: soft layered radial gradients.
  if (unlocks.animatedBackground) {
    const g1 = ctx.createRadialGradient(x + w * 0.2, y + h * 0.3, 0, x + w * 0.2, y + h * 0.3, w * 0.6);
    g1.addColorStop(0, "rgba(125, 211, 252, 0.22)");
    g1.addColorStop(1, "rgba(125, 211, 252, 0)");
    ctx.fillStyle = g1;
    roundedRect(ctx, x, y, w, h, r);
    ctx.fill();
    const g2 = ctx.createRadialGradient(x + w * 0.8, y + h * 0.7, 0, x + w * 0.8, y + h * 0.7, w * 0.55);
    g2.addColorStop(0, "rgba(201, 184, 255, 0.20)");
    g2.addColorStop(1, "rgba(201, 184, 255, 0)");
    ctx.fillStyle = g2;
    roundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  // Level 6 — Holographic Layer: a static diagonal sheen.
  if (unlocks.holographicLayer) {
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, x, y, w, h, r);
    ctx.clip();
    const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
    sheen.addColorStop(0.0, "rgba(255, 255, 255, 0.0)");
    sheen.addColorStop(0.4, "rgba(186, 230, 253, 0.30)");
    sheen.addColorStop(0.55, "rgba(255, 215, 106, 0.28)");
    sheen.addColorStop(0.7, "rgba(201, 184, 255, 0.22)");
    sheen.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = sheen;
    ctx.globalCompositeOperation = "screen";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // Level 2 — Ice Profile Frame + Level 8 — Rare Border: layered premium stroke.
  if (unlocks.iceFrame || unlocks.rareBorder) {
    const color = unlocks.rareBorder ? "rgba(201, 184, 255, 0.85)" : "rgba(186, 230, 253, 0.75)";
    const inset = unlocks.rareBorder ? 6 : 4;
    ctx.save();
    roundedRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, r - 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = unlocks.rareBorder ? 3 : 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = unlocks.rareBorder ? 18 : 10;
    ctx.stroke();
    ctx.restore();
  }

  // Level 16 — Prism Aura: soft conic-style outer glow rendered as radial halos.
  if (unlocks.prismAura) {
    ctx.save();
    const halo = ctx.createRadialGradient(x + w / 2, y + h / 2, w * 0.35, x + w / 2, y + h / 2, w * 0.95);
    halo.addColorStop(0, "rgba(127, 227, 210, 0.0)");
    halo.addColorStop(0.55, "rgba(127, 227, 210, 0.16)");
    halo.addColorStop(0.8, "rgba(201, 184, 255, 0.18)");
    halo.addColorStop(1, "rgba(127, 227, 210, 0.0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    roundedRect(ctx, x - 60, y - 60, w + 120, h + 120, r + 10);
    ctx.fill();
    ctx.restore();
  }

  // Level 12 — Ritual OG Badge (static, no animation).
  if (unlocks.ritualOgBadge) {
    const badgeW = 110;
    const badgeH = 36;
    const bx = x + w - badgeW - 32;
    const by = y + 32;
    ctx.save();
    roundedRect(ctx, bx, by, badgeW, badgeH, 18);
    ctx.fillStyle = "rgba(2,8,7,0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 215, 106, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffd76a";
    ctx.font = "bold 16px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("RITUAL OG", bx + 14, by + badgeH / 2);
    ctx.restore();
  }

  ctx.restore();
}

export type RenderOptions = {
  tokenId?: number;
  identityRank?: string;
  currentPower?: number;
  currentRarity?: number;
  /** Source of truth for static Visual Evolution effects rendered into the SVG image. */
  trainingLevel?: number;
};

/**
 * Render the anthem as a single 1000x1000 holographic trading card PNG:
 * the X profile photo is the main subject inside a gradient record ring, with
 * a fixed template (logo, rarity badge, name, archetype/class, power score,
 * traits, mint footer) and rarity-driven frame/foil/glow/particles/background.
 * Layout is constant across the collection; only the rarity layer changes.
 */
export async function renderAnthemCard(anthem: Anthem, opts: RenderOptions = {}): Promise<Blob> {
  const canvas = await drawCard(anthem, opts);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/png"),
  );
}

/** Same card as a data URL — used for the live mint preview. */
export async function renderAnthemCardDataUrl(anthem: Anthem, opts: RenderOptions = {}): Promise<string> {
  const canvas = await drawCard(anthem, opts);
  return canvas.toDataURL("image/png");
}

async function drawCard(anthem: Anthem, opts: RenderOptions): Promise<HTMLCanvasElement> {
  const W = 1000;
  const H = 1000;
  // Ensure Share Tech Mono is loaded before any ctx.font references it —
  // otherwise the browser falls back to a default font mid-draw and the
  // handle renders in Arial. document.fonts.load() returns a promise that
  // resolves once the specific face is available.
  if (typeof document !== "undefined" && (document as any).fonts?.load) {
    try {
      await (document as any).fonts.load('bold 54px "Share Tech Mono"');
    } catch {
      // Fall back gracefully — canvas will use the next family in the stack.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  // Use evolved power/rarity only after a valid positive snapshot value is provided.
  // Never render undefined/null/failed snapshot as 000.
  const hasValidSnapshotPower = opts.currentPower !== undefined && opts.currentPower > 0;
  const displayPower = hasValidSnapshotPower ? opts.currentPower! : anthem.score;
  if (!Number.isFinite(displayPower) || displayPower <= 0) {
    throw new Error("card power unavailable");
  }
  const displayRarityStr = opts.currentRarity !== undefined
    ? (["INITIATE","BITTY","RITTY","RITUALIST","RADIANT"][opts.currentRarity] || anthem.rarity)
    : anthem.rarity;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preset = getRarityPreset(displayRarityStr as any);
  const accent = anthem.accent;
  const rng = makeRng(anthem.seed || 1);

  // Card frame geometry — every layer lives inside this rounded rect (no inner box).
  const fx = 26;
  const fy = 26;
  const fw = W - 52;
  const fh = H - 52;
  const fr = 36;

  // ---- LAYER 1: card background ----
  drawBackground(ctx, W, H, anthem, preset);

  // Clip all artwork/overlays to the rounded card.
  ctx.save();
  roundedRect(ctx, fx, fy, fw, fh, fr);
  ctx.clip();

  // ---- LAYER 2: full-card profile portrait (object-fit: cover, no hard container) ----
  let drew = false;
  if (anthem.xHandle || anthem.portraitUrl) {
    try {
      const img = await loadImage(anthem.portraitUrl || avatarUrl(anthem.xHandle));
      const ir = img.width / img.height;
      const dr = fw / fh;
      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;
      if (ir > dr) {
        // wider than the card — crop sides, keep centre
        sw = sh * dr;
        sx = (img.width - sw) / 2;
      } else {
        // taller than the card — crop top/bottom, bias toward the top so the face stays
        sh = sw / dr;
        sy = (img.height - sh) * 0.35;
      }
      ctx.globalAlpha = 0.84; // visible artwork, slightly subdued for text contrast
      ctx.drawImage(img, sx, sy, sw, sh, fx, fy, fw, fh);
      ctx.globalAlpha = 1;
      drew = true;
    } catch {
      drew = false;
    }
  }
  if (!drew) {
    const g = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    applyStops(g, anthem.gradient ?? ["#7fe3d2", "#48a89a", "#063a33"]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.globalAlpha = 1;
    drawRitualGlyph(ctx, W / 2, H / 2 - 30, 330, 0.88, true);
  }

  // ---- LAYER 3: holographic foil overlay (over the artwork) ----
  drawFoil(ctx, fx, fy, fw, fh, fr, preset, rng);

  // ---- LAYER 4: dark readability gradients (top for header, bottom for the stats block) ----
  const bottom = ctx.createLinearGradient(0, fy + fh * 0.46, 0, fy + fh);
  bottom.addColorStop(0, "rgba(4,8,7,0)");
  bottom.addColorStop(0.5, "rgba(4,8,7,0.6)");
  bottom.addColorStop(1, "rgba(4,8,7,0.96)");
  ctx.fillStyle = bottom;
  ctx.fillRect(fx, fy + fh * 0.46, fw, fh * 0.54);

  const top = ctx.createLinearGradient(0, fy, 0, fy + 180);
  top.addColorStop(0, "rgba(4,8,7,0.72)");
  top.addColorStop(1, "rgba(4,8,7,0)");
  ctx.fillStyle = top;
  ctx.fillRect(fx, fy, fw, 180);

  // ---- Sparkle field over the artwork (kept under the text for readability) ----
  drawParticles(ctx, W, H, preset, accent, rng);

  ctx.restore(); // end card clip

  // ---- LAYER 5: border / frame ----
  drawFrame(ctx, fx, fy, fw, fh, fr, preset, accent);

  // Visual Evolution Roadmap — static SVG mirror of the live UI effects.
  // trainingLevel is the single source of truth.
  const visualUnlocks = getVisualEvolutionUnlocks(opts.trainingLevel);
  drawVisualEvolutionEffects(ctx, fx, fy, fw, fh, fr, visualUnlocks);

  // ---- LAYER 6: text / rarity / score / metadata (printed on the artwork) ----
  drawLogo(ctx, 56, 86, accent);
  drawRarityBadge(ctx, W - 56, 86, anthem, preset);
  drawIdentityRankBadge(ctx, 58, 118, opts.identityRank);

  // Identity (bottom-left) + power score (bottom-right), with a soft text shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 1;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 54px "Share Tech Mono", monospace';
  ctx.fillText(anthem.xHandle ? `@${anthem.xHandle}` : "anon", 60, 716);

  // Role · Class
  ctx.fillStyle = accent;
  ctx.font = "bold 26px Arial, sans-serif";
  ctx.fillText(`${anthem.cardArchetype}  ·  ${anthem.mood}`, 60, 752);

  // Passive Class ability (duel)
  ctx.fillStyle = "rgba(232,239,238,0.88)";
  ctx.font = "bold 19px Arial, sans-serif";
  ctx.fillText(`CLASS ABILITY · ${classAbility(anthem.mood).name}`, 60, 782);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(232,239,238,0.82)";
  ctx.font = "bold 18px Arial, sans-serif";
  ctx.fillText("POWER", W - 60, 692);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 66px Arial, sans-serif";
  ctx.fillText(String(displayPower).padStart(3, "0"), W - 60, 756);
  ctx.restore();

  // Trait pills (semi-transparent glass, not solid panels)
  let tx = 60;
  const pillY = 802;
  const pillH = 42;
  anthem.cardTraits.slice(0, 3).forEach((t) => {
    ctx.font = "bold 19px Arial, sans-serif";
    const tw = ctx.measureText(t).width + 34;
    if (tx + tw > W - 60) return;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    roundedRect(ctx, tx, pillY, tw, pillH, 12);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, tx, pillY, tw, pillH, 12);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, tx + tw / 2, pillY + pillH / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    tx += tw + 12;
  });

  // Footer: serial / mint id / generation
  const serial = opts.tokenId != null ? nftSerial(opts.tokenId) : nftSerial(anthem.seed % 1_000_000);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 900);
  ctx.lineTo(W - 60, 900);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(232,239,238,0.66)";
  ctx.font = "bold 15px Arial, sans-serif";
  ctx.fillText("NFT SERIAL", 60, 928);
  ctx.fillStyle = "#e8efee";
  ctx.font = "bold 20px Arial, sans-serif";
  ctx.fillText(serial, 60, 954);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(232,239,238,0.66)";
  ctx.font = "bold 15px Arial, sans-serif";
  ctx.fillText("MINT ID", W / 2, 928);
  ctx.fillStyle = "#e8efee";
  ctx.font = "bold 20px Arial, sans-serif";
  ctx.fillText(anthem.mintId, W / 2, 954);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(232,239,238,0.66)";
  ctx.font = "bold 15px Arial, sans-serif";
  ctx.fillText("SEASON", W - 60, 928);
  ctx.fillStyle = "#e8efee";
  ctx.font = "bold 20px Arial, sans-serif";
  ctx.fillText(`S${SEASON}`, W - 60, 954);

  return canvas;
}
