// TanStack Start & Nitro build configuration.
// Bundles Vite plugins for TanStack Start, React 19, Tailwind CSS v4, path aliases, and Nitro deployment.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
