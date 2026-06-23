import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/viem/") || id.includes("\\viem\\")) return "vendor-viem";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("\\react\\") ||
            id.includes("\\react-dom\\") ||
            id.includes("\\scheduler\\")
          ) {
            return "vendor-react";
          }
          if (id.includes("/lucide-react/") || id.includes("\\lucide-react\\")) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
});
