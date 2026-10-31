import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FingerprintAppProvider } from "@/components/FingerprintAppProvider";
import { HttpVotingService } from "@/features/voting/http-service";
import { _setVotingServiceForTests } from "@/features/voting/service";
import { Route } from "@/routes/vote";

const VotePage = Route.options.component as () => React.ReactElement;
const renderVotePage = () =>
  render(
    <FingerprintAppProvider>
      <VotePage />
    </FingerprintAppProvider>,
  );

const ACTIVE_QUESTION_PAYLOAD = {
  event: { id: "e1", name: "ADIPEC 2026", slug: "adipec-2026" },
  question: {
    id: "q1",
    prompt: "Your future in UAE industry",
    subtitle: "Which one is YOU?",
    status: "active",
  },
  options: [
    {
      id: "opt-1",
      label: "Business owner",
      description: "Start your own factory or company",
      iconKey: "business-owner",
      displayOrder: 1,
    },
    {
      id: "opt-2",
      label: "Industrial investor",
      description: "Invest in new UAE factories",
      iconKey: "industrial-investor",
      displayOrder: 2,
    },
  ],
};

const RESULTS_PAYLOAD = {
  questionId: "q1",
  totalResponses: 1,
  generatedAt: new Date().toISOString(),
  results: [
    { answerOptionId: "opt-1", label: "Business owner", voteCount: 1, percentage: 100 },
    { answerOptionId: "opt-2", label: "Industrial investor", voteCount: 0, percentage: 0 },
  ],
};

describe("Anonymous One-Time Voting Flow (/vote)", () => {
  afterEach(() => {
    cleanup();
    _setVotingServiceForTests(null);
  });

  it("first visit allows voting; repeat visit using same browser profile displays already-voted message and blocks re-voting", async () => {
    let visitorHasVoted = false;

    const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/questions/active")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...ACTIVE_QUESTION_PAYLOAD,
              hasVoted: visitorHasVoted,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/votes") && init?.method === "POST") {
        if (visitorHasVoted) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "ALREADY_VOTED",
                  message:
                    "You've already voted! Your response has been successfully recorded. Thank you for participating.",
                },
              }),
              { status: 409, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        visitorHasVoted = true;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              voteId: "v-new",
              questionId: "q1",
              answerOptionId: "opt-1",
              acceptedAt: new Date().toISOString(),
              replayed: false,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/results")) {
        return Promise.resolve(
          new Response(JSON.stringify(RESULTS_PAYLOAD), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const httpService = new HttpVotingService(
      "http://localhost:8082",
      mockFetch as unknown as typeof fetch,
    );
    _setVotingServiceForTests(httpService);

    // 1. First Visit: Load /vote
    const { unmount } = renderVotePage();
    fireEvent.click(screen.getByText("Let's find out"));

    // Options are displayed
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.queryByText(/already voted/i)).toBeNull();

    // Select option 1
    fireEvent.click(radios[0]!);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");

    const proceedBtn = screen.getByText("Proceed").closest("button")!;
    expect(proceedBtn.disabled).toBe(false);

    // Submit vote
    fireEvent.click(proceedBtn);

    // Reaches Thank You step
    await screen.findByText(/for taking part/i, undefined, { timeout: 3000 });
    expect(screen.getByText("Your choice has been submitted.")).toBeTruthy();

    // 2. Click "Back to home"
    fireEvent.click(screen.getByText("Back to home"));
    await screen.findByText("Let's find out");

    // Click "Let's find out" again in the same browser session
    fireEvent.click(screen.getByText("Let's find out"));
    await screen.findAllByRole("radio");

    // Verify already-voted message is displayed and Proceed is disabled
    expect(
      screen.getByText(
        "You've already voted! Your response has been successfully recorded. Thank you for participating.",
      ),
    ).toBeTruthy();
    const blockedProceed = screen.getByText("Proceed").closest("button")!;
    expect(blockedProceed.disabled).toBe(true);

    // 3. Repeat Visit / Page Refresh: Unmount and remount fresh VotePage
    unmount();
    renderVotePage();

    // Click "Let's find out" on fresh mount
    fireEvent.click(screen.getByText("Let's find out"));
    await screen.findAllByRole("radio");

    // Message is displayed from subsequent visit check (hasVoted: true)
    await screen.findByText(
      "You've already voted! Your response has been successfully recorded. Thank you for participating.",
    );
    expect(screen.getByText("Proceed").closest("button")!.disabled).toBe(true);
  });

  it("server 409 ALREADY_VOTED error displays exact rejection message", async () => {
    const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/questions/active")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...ACTIVE_QUESTION_PAYLOAD,
              hasVoted: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/votes") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "ALREADY_VOTED",
                message:
                  "You've already voted! Your response has been successfully recorded. Thank you for participating.",
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/results")) {
        return Promise.resolve(
          new Response(JSON.stringify(RESULTS_PAYLOAD), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const httpService = new HttpVotingService(
      "http://localhost:8082",
      mockFetch as unknown as typeof fetch,
    );
    _setVotingServiceForTests(httpService);

    renderVotePage();
    fireEvent.click(screen.getByText("Let's find out"));

    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[0]!);

    const proceedBtn = screen.getByText("Proceed").closest("button")!;
    fireEvent.click(proceedBtn);

    // Verify rejection message
    await screen.findByRole("alert");
    expect(
      screen.getByText(
        "You've already voted! Your response has been successfully recorded. Thank you for participating.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/for taking part/i)).toBeNull();
  });
});
