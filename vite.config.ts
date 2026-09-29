import { defineConfig } from "vite";

export default defineConfig({
  // Deploy path prefix, e.g. "/gistd/" for GitHub project pages.
  base: process.env.GISTD_BASE || "/",
  build: {
    assetsInlineLimit: (id, content) =>
      id.endsWith(".css") || content.length < 4096,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
