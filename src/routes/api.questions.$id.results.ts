import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/questions/$id/results")({
  server: {
    handlers: {
      GET: async ({ request, params }) => (await import("@/server/handlers")).handleResults(request, params.id),
      OPTIONS: async ({ request, params }) => (await import("@/server/handlers")).handleResults(request, params.id),
    },
  },
});
