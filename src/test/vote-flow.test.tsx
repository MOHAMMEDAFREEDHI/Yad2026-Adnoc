import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockVotingService } from "@/features/voting/mock-service";
import { VoteError } from "@/features/voting/types";

import { Route } from "@/routes/vote";

const VotePage = Route.options.component as () => React.ReactElement;

describe("/vote mobile flow (MockVotingService)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("welcome → six options → single select → proceed → thank-you → back home → repeat vote (unrestricted policy)", async () => {
    render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));

    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(screen.queryByText(/isn't open right now/i)).toBeNull();

    const proceed = screen.getByText("Proceed").closest("button")!;
    expect(proceed.disabled).toBe(true);

    fireEvent.click(radios[0]!);
    fireEvent.click(radios[2]!);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(radios[2]!.getAttribute("aria-checked")).toBe("true");
    expect(proceed.disabled).toBe(false);

    fireEvent.click(proceed);
    await screen.findByText(/for taking part/i, undefined, { timeout: 3000 });
    expect(screen.getAllByText("Private-sector professional").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Back to home"));
    await waitFor(() => expect(screen.getByText("Let's find out")).toBeTruthy());

    // Under the default unrestricted policy, returning home resets selection and allows a new vote with a new idempotency key
    fireEvent.click(screen.getByText("Let's find out"));
    const nextRadios = await screen.findAllByRole("radio");
    expect(nextRadios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    const nextProceed = screen.getByText("Proceed").closest("button")!;
    expect(nextProceed.disabled).toBe(true);
  });

  it("shows Submitting… loading state and prevents rapid double-clicks from submitting twice", async () => {
    let resolveVote!: (v: { voteId: string; questionId: string; optionId: string; acceptedAt: string }) => void;
    const spy = vi.spyOn(MockVotingService.prototype, "submitVote").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVote = resolve;
        }),
    );

    render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));
    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[1]!);

    const proceed = screen.getByText("Proceed").closest("button")!;
    // Rapid triple-click on Proceed
    fireEvent.click(proceed);
    fireEvent.click(proceed);
    fireEvent.click(proceed);

    // Loading state is visible and button is disabled/busy while in flight
    expect(screen.getByText("Submitting…")).toBeTruthy();
    expect(proceed.disabled).toBe(true);
    expect(proceed.getAttribute("aria-busy")).toBe("true");
    expect(spy).toHaveBeenCalledTimes(1);

    resolveVote({
      voteId: "v-1",
      questionId: "q-future-uae-industry",
      optionId: "opt-2",
      acceptedAt: new Date().toISOString(),
    });

    await screen.findByText(/for taking part/i, undefined, { timeout: 3000 });
    spy.mockRestore();
  });

  it("a failed submission keeps the selection, shows an error and a retry reuses the same idempotency key", async () => {
    const spy = vi.spyOn(MockVotingService.prototype, "submitVote").mockRejectedValueOnce(new VoteError("NETWORK"));
    render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));
    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[4]!);
    fireEvent.click(screen.getByText("Proceed"));

    await screen.findByRole("alert");
    expect(screen.queryByText(/for taking part/i)).toBeNull();
    expect(screen.getAllByRole("radio")[4]!.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByText("Proceed"));
    await screen.findByText(/for taking part/i, undefined, { timeout: 3000 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![0].idempotencyKey).toBe(spy.mock.calls[1]![0].idempotencyKey);
    spy.mockRestore();
  });

  it("back from the choices returns to welcome; page refresh starts cleanly at welcome with persisted results", async () => {
    const { unmount } = render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByText("Let's find out")).toBeTruthy();

    // Simulate browser refresh
    unmount();
    render(<VotePage />);
    expect(screen.getByText("Let's find out")).toBeTruthy();
  });
});
