import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_QUESTION, MockVotingService } from "@/features/voting/mock-service";
import { _setVotingServiceForTests } from "@/features/voting/service";
import { VoteError } from "@/features/voting/types";

import { Route } from "@/routes/vote";

const VotePage = Route.options.component as () => React.ReactElement;

describe("/vote mobile flow (MockVotingService)", () => {
  beforeEach(() => {
    localStorage.clear();
    _setVotingServiceForTests(new MockVotingService());
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    _setVotingServiceForTests(null);
  });

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

  it("Scenario 1 & 5: loads six options on first request when active and stops retrying after success", async () => {
    vi.useFakeTimers();
    const mock = new MockVotingService();
    const spy = vi.spyOn(mock, "getActiveQuestion").mockResolvedValue(MOCK_QUESTION);
    _setVotingServiceForTests(mock);

    render(<VotePage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Let's find out"));
    expect(screen.getAllByRole("radio")).toHaveLength(6);

    // Scenario 5: advancing timers or triggering focus/online after success makes zero extra requests
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Scenario 2: automatically recovers via bounded backoff when event transitions from draft to open", async () => {
    vi.useFakeTimers();
    const mock = new MockVotingService();
    const spy = vi
      .spyOn(mock, "getActiveQuestion")
      .mockRejectedValueOnce(new VoteError("QUESTION_UNAVAILABLE"))
      .mockResolvedValue(MOCK_QUESTION);
    _setVotingServiceForTests(mock);

    render(<VotePage />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Let's find out"));
    expect(screen.getByRole("alert").textContent).toContain("Voting isn't open right now. Please try again shortly.");
    expect(spy).toHaveBeenCalledTimes(1);

    // Advance 5s (first backoff interval) -> automatically recovers and renders 6 options without clicking Try again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(6);

    // Confirm no further retries after recovery
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("Scenario 3: when event remains draft, retries only on bounded backoff schedule (5s, 10s, 20s, 30s cap)", async () => {
    vi.useFakeTimers();
    const mock = new MockVotingService();
    const spy = vi.spyOn(mock, "getActiveQuestion").mockRejectedValue(new VoteError("QUESTION_UNAVAILABLE"));
    _setVotingServiceForTests(mock);

    render(<VotePage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Let's find out"));
    expect(screen.getByRole("alert").textContent).toContain("Voting isn't open right now");

    // 1st retry at +5s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(spy).toHaveBeenCalledTimes(2);

    // 2nd retry at +10s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(spy).toHaveBeenCalledTimes(3);

    // 3rd retry at +20s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(spy).toHaveBeenCalledTimes(4);

    // 4th retry at +30s (capped)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(spy).toHaveBeenCalledTimes(5);

    // 5th retry remains capped at +30s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it("Scenario 4 & 6: temporary network failure shows network message and recovers on reconnect or manual Try again", async () => {
    vi.useFakeTimers();
    const mock = new MockVotingService();
    const spy = vi
      .spyOn(mock, "getActiveQuestion")
      .mockRejectedValueOnce(new VoteError("NETWORK"))
      .mockRejectedValueOnce(new VoteError("QUESTION_UNAVAILABLE"))
      .mockResolvedValue(MOCK_QUESTION);
    _setVotingServiceForTests(mock);

    render(<VotePage />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Let's find out"));
    expect(screen.getByRole("alert").textContent).toContain("No connection. Check your internet and try again.");

    // Reconnect event triggers immediate check
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toContain("Voting isn't open right now");

    // Manual "Try again" click triggers immediate check and loads options
    await act(async () => {
      fireEvent.click(screen.getByText("Try again"));
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole("radio")).toHaveLength(6);
  });
});
