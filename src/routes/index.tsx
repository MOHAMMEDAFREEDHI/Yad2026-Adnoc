import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ADIPEC 2026 — ADNOC voting" },
      { name: "description", content: "ADNOC voting microsite for ADIPEC 2026." },
      { property: "og:title", content: "ADIPEC 2026 — ADNOC voting" },
      { property: "og:description", content: "ADNOC voting microsite for ADIPEC 2026." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/vote" });
  },
});
