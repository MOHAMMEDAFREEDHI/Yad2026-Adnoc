// End-to-end frontend UI (/vote) -> HttpVotingService -> live HTTP API -> AWS RDS verification.
// Skipped unless RUN_E2E_HTTP=1 is set.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HttpVotingService } from "@/features/voting/http-service";
import { _setVotingServiceForTests } from "@/features/voting/service";
import { Route } from "@/routes/vote";

const VotePage = Route.options.component as () => React.ReactElement;
const baseUrl = process.env["E2E_API_URL"] || "http://localhost:8082";
const d = process.env["RUN_E2E_HTTP"] === "1" ? describe : describe.skip;

d("/vote frontend connected to real HTTP API + AWS RDS", () => {
  afterEach(() => {
    cleanup();
    _setVotingServiceForTests(null);
  });

  it("loads active question from HTTP API, submits vote to RDS, displays thank-you + updated percentage, and reloads cleanly on refresh", async () => {
    // Same-origin style HttpVotingService ("/" routed to local dev server in jsdom)
    const sameOriginFetch: typeof fetch = (input, init) => {
      const url = typeof input === "string" && input.startsWith("/") ? `${baseUrl}${input}` : input;
      return fetch(url, init);
    };
    const httpSvc = new HttpVotingService("/", sameOriginFetch);
    _setVotingServiceForTests(httpSvc);

    const beforeResults = await httpSvc.getResults("cea3cba2-3ae7-4356-ac38-505ea75c0dd3");
    const beforeTotal = beforeResults.totalVotes;
    const beforeOpt5 = beforeResults.results.find(
      (r) => r.optionId === "9fa1b192-a290-4dd4-bdf7-c010ff1a591e",
    )!.count;

    // 1. Open /vote
    const { unmount } = render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));

    // 2. Load the active question & 6 options from the backend
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(screen.getByText("Data & AI in industry")).toBeTruthy();

    // 3. Select "Data & AI in industry" (display_order = 5 -> index 4)
    fireEvent.click(radios[4]!);
    expect(radios[4]!.getAttribute("aria-checked")).toBe("true");

    // 4. Submit the vote through the HTTP API
    const proceed = screen.getByText("Proceed").closest("button")!;
    expect(proceed.disabled).toBe(false);
    fireEvent.click(proceed);

    // 5 & 6. Confirm thank-you screen is reached and displays the submitted option
    await screen.findByText(/for taking part/i, undefined, { timeout: 5000 });
    expect(screen.getByText("Your choice has been submitted.")).toBeTruthy();
    expect(screen.getAllByText("Data & AI in industry").length).toBeGreaterThan(0);

    // 7. Retrieve updated results from the backend and confirm persistence in AWS RDS
    const afterResults = await httpSvc.getResults("cea3cba2-3ae7-4356-ac38-505ea75c0dd3");
    expect(afterResults.totalVotes).toBe(beforeTotal + 1);
    const afterOpt5 = afterResults.results.find(
      (r) => r.optionId === "9fa1b192-a290-4dd4-bdf7-c010ff1a591e",
    )!;
    expect(afterOpt5.count).toBe(beforeOpt5 + 1);
    await waitFor(() => {
      expect(screen.getByText(`${afterOpt5.percent}%`)).toBeTruthy();
    });

    // 8. Simulate page refresh: unmount, remount fresh <VotePage />, and verify updated data is retrieved again
    unmount();
    render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));
    const refreshedRadios = await screen.findAllByRole("radio");
    expect(refreshedRadios).toHaveLength(6);
    await waitFor(() => {
      expect(screen.getAllByText(`${afterOpt5.percent}%`).length).toBeGreaterThan(0);
    });
  });
});
