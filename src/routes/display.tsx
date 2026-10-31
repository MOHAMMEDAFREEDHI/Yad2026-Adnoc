import { createFileRoute } from "@tanstack/react-router";
import { Building2, Cpu, Factory, HardHat, Lightbulb, Rocket } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import displayLogoUrl from "@/assets/display/Asset 2 1.png";
import displayHeaderAssetUrl from "@/assets/display/Frame 1000011482.png";
import displayVideoUrl from "@/assets/display/Zone 5 BG Loop 4K.mp4";
import displayPosterUrl from "@/assets/voting/Asset 2@3x 2.png";
import { MOCK_QUESTION } from "@/features/voting/mock-service";
import { OPTION_VISUALS } from "@/features/voting/presentation";
import { getVotingService } from "@/features/voting/service";
import type { AnswerOption, OptionKey, Question, ResultsSnapshot } from "@/features/voting/types";

export const Route = createFileRoute("/display")({
  head: () => ({
    meta: [
      { title: "Live results — Your future in UAE industry" },
      {
        name: "description",
        content: "Live ADIPEC 2026 voting results for the portrait LED screen.",
      },
      { property: "og:title", content: "Live results — Your future in UAE industry" },
      {
        property: "og:description",
        content: "Live ADIPEC 2026 voting results for the portrait LED screen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DisplayPage,
});

const STAGE_WIDTH = 2160;
const STAGE_HEIGHT = 3840;

function usePortraitStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth || STAGE_WIDTH;
      const h = window.innerHeight || STAGE_HEIGHT;
      setScale(Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

/** Hide the cursor after inactivity; block context menu & drag on this surface only. */
function useKioskHygiene() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
    };
  }, []);
  return idle;
}

function DisplayBackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      el.pause();
      return;
    }
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // Autoplay blocked or unavailable; static fallback image remains visible beneath.
      });
    }
  }, []);

  return (
    <>
      <img
        src={displayPosterUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="led-bg-poster"
      />
      <video
        ref={videoRef}
        src={displayVideoUrl}
        poster={displayPosterUrl}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        className="led-bg-video"
      />
      <div className="led-bg-tint" aria-hidden="true" />
    </>
  );
}

function renderDisplayIcon(key: OptionKey) {
  const commonProps = {
    size: 90,
    strokeWidth: 1.75,
    className: "text-white",
    "aria-hidden": true as const,
  };
  if (key === "business-owner") return <Rocket {...commonProps} />;
  if (key === "industrial-investor") return <Factory {...commonProps} />;
  if (key === "private-sector") return <Building2 {...commonProps} />;
  if (key === "industrial-specialist") return <HardHat {...commonProps} />;
  if (key === "data-ai") return <Cpu {...commonProps} />;
  if (key === "something-else") return <Lightbulb {...commonProps} />;
  const FallbackIcon = OPTION_VISUALS[key as OptionKey]?.icon ?? Lightbulb;
  return <FallbackIcon {...commonProps} />;
}

function DisplayResultCard({
  option,
  percent,
  voteCount,
}: {
  option: AnswerOption;
  percent: number;
  voteCount: number;
}) {
  const clampedPct = Math.min(100, Math.max(0, Math.round(percent)));

  return (
    <article
      className="led-portrait-card"
      data-option-id={option.id}
      data-option-key={option.key}
      data-vote-count={voteCount}
    >
      <div className="relative w-[662.05px] h-[470.94px]">
        <div className="flex items-center justify-start w-[106px] h-[102px]">
          {renderDisplayIcon(option.key)}
        </div>

        <div className="mt-[24px] flex flex-col items-start gap-[13.65px] w-[662.05px]">
          <h2 className="led-portrait-card-title">{option.label}</h2>
          {option.description && <p className="led-portrait-card-desc">{option.description}</p>}
        </div>

        <div className="absolute left-0 bottom-0 w-[662.05px] h-[51.19px] flex items-center gap-[40.95px]">
          <div
            className="led-portrait-track"
            role="progressbar"
            aria-valuenow={clampedPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${option.label} vote share`}
          >
            <div className="led-portrait-fill" style={{ width: `${clampedPct}%` }} />
          </div>
          <span className="led-portrait-pct">{clampedPct}%</span>
        </div>
      </div>
    </article>
  );
}

function DisplayPage() {
  const service = getVotingService();
  const scale = usePortraitStageScale();
  const idle = useKioskHygiene();
  const [question, setQuestion] = useState<Question | null>(null);
  const [snap, setSnap] = useState<ResultsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const load = async () => {
      clearRetry();
      try {
        const q = await service.getActiveQuestion();
        if (cancelled) return;
        setQuestion(q);
        const initialResults = await service.getResults(q.id);
        if (cancelled) return;
        setSnap(initialResults);
        unsub();
        unsub = service.subscribeResults(q.id, (nextSnap) => {
          if (!cancelled) setSnap(nextSnap);
        });
      } catch {
        if (cancelled) return;
        retryTimer = setTimeout(load, 5000);
      }
    };

    void load();

    const refresh = () => {
      void load();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearRetry();
      unsub();
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [service]);

  const activeQuestion = question ?? MOCK_QUESTION;
  const sortedOptions = [...activeQuestion.options].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <main
      className="led-viewport"
      style={{ cursor: idle ? "none" : "default" }}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      onClickCapture={(e) => e.preventDefault()}
      data-total-votes={snap?.totalVotes ?? 0}
    >
      <DisplayBackgroundVideo />

      <div className="led-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {/* Upper-right vertical ADNOC badge (Asset 2 1.png) */}
        <img
          src={displayLogoUrl}
          alt="ADNOC"
          draggable={false}
          className="absolute left-[1719.71px] top-[219px] w-[260.57px] h-[393.35px] object-contain select-none pointer-events-none"
        />

        {/* Main portrait content container (Frame 1000011487) */}
        <div className="absolute left-[229px] top-[701.21px] w-[1702.28px] h-[2524.67px] flex flex-col items-start gap-[97.3px]">
          {/* Header block (Frame 1000011482) */}
          <header
            className=" flex flex-col items-start gap-[29.95px] w-[1461.34px] h-[559.95px]"
            data-header-asset={displayHeaderAssetUrl}
          >
            <h1 className="led-portrait-title w-[1461.34px] h-[407px] flex flex-col justify-center">
              <span>YOUR FUTURE IN</span>
              <span>UAE INDUSTRY</span>
            </h1>
            <p className="led-portrait-prompt w-[1461.34px] h-[123px] whitespace-nowrap">
              {activeQuestion.prompt || "Which one is YOU?"} Tap your choice
            </p>
          </header>

          {/* Six result cards in a 2-column x 3-row grid (Frame 1000011481) */}
          <section
            aria-label="Live voting results"
            className="grid grid-cols-2 gap-x-[47.31px] gap-y-[47.31px] w-[1702.28px] h-[1867.42px]"
          >
            {sortedOptions.map((option) => {
              const entry = snap?.results.find((r) => r.optionId === option.id);
              const pct = question && snap ? (entry?.percent ?? 0) : 0;
              const count = question && snap ? (entry?.count ?? 0) : 0;
              return (
                <DisplayResultCard
                  key={option.id}
                  option={option}
                  percent={pct}
                  voteCount={count}
                />
              );
            })}
          </section>
        </div>
      </div>
    </main>
  );
}
