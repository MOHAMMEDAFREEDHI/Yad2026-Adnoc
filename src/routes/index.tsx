import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ADNOC Young Voting Microsite — ADIPEC 2026" },
      { name: "description", content: "ADNOC Young Voting Microsite for ADIPEC 2026." },
      { property: "og:title", content: "ADNOC Young Voting Microsite — ADIPEC 2026" },
      { property: "og:description", content: "ADNOC Young Voting Microsite for ADIPEC 2026." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/vote" });
  },
});
