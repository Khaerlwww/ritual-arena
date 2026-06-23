import type { Config } from "tailwindcss";

/**
 * "Windows 2000 meets Ritual Chain" — a desktop OS for onchain AI music.
 * Dark Ritual atmosphere + authentic gray Win2000 chrome.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Desktop / Ritual atmosphere
        void: "#050505",
        coal: "#0B0B0B",
        emerald2: "#053931", // Ritual Emerald
        teal2: "#00524D", // Deep Teal
        aqua: "#48A89A", // Aqua Accent
        iceaccent: "#CBEFEB", // Ice Accent
        ice: "#EAF7F5",
        // Classic Windows chrome
        wgray: "#C0C0C0",
        wlight: "#DFDFDF",
        wborder: "#808080",
        wshadow: "#404040",

        // Legacy tokens (still used by mood gradients + footer vinyl) remapped to teal family
        drop: "#48A89A",
        dropdark: "#357f72",
        neon: "#7fe3d2",
        anthem: "#2f8a7e",
        bass: "#053931",
        ink: "#050505",
        card: "#0B0B0B",
        vinyl: "#04100e",
      },
      boxShadow: {
        glow: "0 0 40px rgba(72, 168, 154, 0.18)",
        cyan: "0 0 30px rgba(72, 168, 154, 0.25)",
        drop: "0 0 0 1px rgba(0,0,0,0.4)",
      },
      animation: {
        "pack-pulse": "pack-pulse 0.8s ease-in-out infinite",
      },
      keyframes: {
        "pack-pulse": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.08)" },
        },
      },
      fontFamily: {
        // Headline: pixel / terminal energy
        display: ['"JetBrains Mono"', '"IBM Plex Mono"', "ui-monospace", "monospace"],
        ui: ["Tahoma", "Geneva", "Verdana", "sans-serif"],
        sys: ['"MS Sans Serif"', "Tahoma", "Geneva", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        term: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        // Handle: Share Tech Mono (terminal/CRT energy, matches dark/gaming vibe)
        handle: ['"Share Tech Mono"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
