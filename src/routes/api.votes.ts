import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/votes")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/server/handlers")).handleVote(request),
      OPTIONS: async ({ request }) => (await import("@/server/handlers")).handleVote(request),
    },
  },
});
