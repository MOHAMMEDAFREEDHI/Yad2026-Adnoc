import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockVotingService } from "@/features/voting/mock-service";
import { VoteError } from "@/features/voting/types";

import { Route } from "@/routes/vote";

const VotePage = Route.options.component as () => React.ReactElement;

describe("/vote mobile flow (MockVotingService)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("welcome → six options → single select → proceed → thank-you → back home", async () => {
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
  });

  it("a failed submission keeps the selection, shows an error and a retry succeeds", async () => {
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
    spy.mockRestore();
  });

  it("back from the choices returns to welcome", async () => {
    render(<VotePage />);
    fireEvent.click(screen.getByText("Let's find out"));
    await screen.findAllByRole("radio");
    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByText("Let's find out")).toBeTruthy();
  });
});
