import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/questions/active")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/handlers")).handleActiveQuestion(request),
      OPTIONS: async ({ request }) =>
        (await import("@/server/handlers")).handleActiveQuestion(request),
    },
  },
});
