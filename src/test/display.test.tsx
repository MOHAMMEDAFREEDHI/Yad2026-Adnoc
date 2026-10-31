import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_QUESTION, MockVotingService } from "@/features/voting/mock-service";
import { _setVotingServiceForTests } from "@/features/voting/service";
import { VoteError, type ResultsSnapshot } from "@/features/voting/types";
import { Route } from "@/routes/display";

const DisplayPage = Route.options.component as () => React.ReactElement;

describe("/display portrait LED results screen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    _setVotingServiceForTests(null);
  });

  it("renders portrait header, ADNOC logo, separate background video, and 6 result cards in a 2x3 grid", async () => {
    const mock = new MockVotingService({ latencyMs: 0, seed: false });
    _setVotingServiceForTests(mock);

    const { container } = render(<DisplayPage />);

    // Heading & prompt
    expect(screen.getByText("YOUR FUTURE IN")).toBeTruthy();
    expect(screen.getByText("UAE INDUSTRY")).toBeTruthy();
    expect(screen.getByText(/Which one is YOU\? Tap your choice/i)).toBeTruthy();

    // ADNOC logo
    const logo = screen.getByAltText("ADNOC") as HTMLImageElement;
    expect(logo).toBeTruthy();
    expect(logo.getAttribute("src")).toContain("Asset");

    // Separate background video for /display (Zone 5 BG Loop 4K.mp4, NOT background-video.mp4)
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute("src")).toContain("Zone");
    expect(video.getAttribute("src")).not.toContain("background-video.mp4");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);

    // Wait for initial results (0 votes -> 0% across all 6 options)
    await act(async () => {
      await Promise.resolve();
    });

    const cards = container.querySelectorAll("article.led-portrait-card");
    expect(cards).toHaveLength(6);

    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars).toHaveLength(6);
    for (const bar of progressBars) {
      expect(bar.getAttribute("aria-valuenow")).toBe("0");
    }
    expect(screen.getAllByText("0%")).toHaveLength(6);
  });

  it("updates percentages and progress bars automatically when live voting results change", async () => {
    let listener: ((s: ResultsSnapshot) => void) | null = null;
    const mock = new MockVotingService({ latencyMs: 0, seed: false });
    vi.spyOn(mock, "subscribeResults").mockImplementation((_qId, cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    });
    _setVotingServiceForTests(mock);

    render(<DisplayPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getAllByText("0%")).toHaveLength(6);

    // Push live snapshot with updated votes
    const liveSnapshot: ResultsSnapshot = {
      questionId: MOCK_QUESTION.id,
      totalVotes: 10,
      generatedAt: new Date().toISOString(),
      results: [
        { optionId: "opt-1", count: 4, percent: 40 },
        { optionId: "opt-2", count: 2, percent: 20 },
        { optionId: "opt-3", count: 1, percent: 10 },
        { optionId: "opt-4", count: 1, percent: 10 },
        { optionId: "opt-5", count: 1, percent: 10 },
        { optionId: "opt-6", count: 1, percent: 10 },
      ],
    };

    await act(async () => {
      listener?.(liveSnapshot);
    });

    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getAllByText("10%")).toHaveLength(4);

    const opt1Bar = screen.getByLabelText("Entrepreneur vote share");
    expect(opt1Bar.getAttribute("aria-valuenow")).toBe("40");
  });

  it("recovers automatically after a temporary API failure without breaking the portrait layout", async () => {
    vi.useFakeTimers();
    const mock = new MockVotingService({ latencyMs: 0, seed: true });
    const spy = vi
      .spyOn(mock, "getActiveQuestion")
      .mockRejectedValueOnce(new VoteError("NETWORK"))
      .mockResolvedValue(MOCK_QUESTION);
    _setVotingServiceForTests(mock);

    const { container } = render(<DisplayPage />);
    await act(async () => {
      await Promise.resolve();
    });

    // Layout remains intact with 6 cards at 0% while waiting to recover
    expect(container.querySelectorAll("article.led-portrait-card")).toHaveLength(6);
    expect(screen.getAllByText("0%")).toHaveLength(6);

    // Advance 5s retry timer -> fetches active question & seeded results (26/22/16/14/12/10%)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("26%")).toBeTruthy();
    expect(screen.getByText("22%")).toBeTruthy();
    expect(screen.getByText("16%")).toBeTruthy();
    expect(screen.getByText("14%")).toBeTruthy();
    expect(screen.getByText("12%")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
  });

  it.each([
    [720, 1280, "scale(0.3333333333333333)"],
    [1080, 1920, "scale(0.5)"],
    [1440, 2560, "scale(0.6666666666666666)"],
    [1920, 1080, "scale(0.28125)"],
  ])(
    "scales the 2160x3840 portrait stage accurately without overflow at %ix%i",
    (width, height, expectedScale) => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        configurable: true,
        value: width,
      });
      Object.defineProperty(window, "innerHeight", {
        writable: true,
        configurable: true,
        value: height,
      });
      const mock = new MockVotingService({ latencyMs: 0, seed: false });
      _setVotingServiceForTests(mock);

      const { container } = render(<DisplayPage />);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      const stage = container.querySelector(".led-stage") as HTMLElement;
      expect(stage).toBeTruthy();
      expect(stage.style.transform).toContain(expectedScale);
    },
  );
});
