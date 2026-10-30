import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import thankYouFrameUrl from "@/assets/thank-you/Frame 1000011480.png";
import thankYouBottomOverlayUrl from "@/assets/thank-you/Rectangle 3.png";
import thankYouTopOverlayUrl from "@/assets/thank-you/Rectangle 4.png";
import votingBottomOverlayUrl from "@/assets/voting/Rectangle 3.png";
import votingTopOverlayUrl from "@/assets/voting/Rectangle 4.png";
import welcomeSubtitleUrl from "@/assets/welcome/div5.png";
import welcomeDreamJobUrl from "@/assets/welcome/dream job_.png";
import welcomeYourUrl from "@/assets/welcome/YOUR.png";
import {
  AdnocLogo,
  BackgroundVideo,
  GrabberBar,
  OptionCard,
  PillButton,
  SelectedSummary,
  TopBar,
} from "@/features/voting/components/MobileUI";
import { getVotingService, newIdempotencyKey, VOTE_ERROR_MESSAGES } from "@/features/voting/service";
import { VoteError, type AnswerOption, type Question, type ResultsSnapshot } from "@/features/voting/types";

export const Route = createFileRoute("/vote")({
  head: () => ({
    meta: [
      { title: "What's YOUR dream job? — ADNOC at ADIPEC 2026" },
      { name: "description", content: "A few taps to find where you fit in the UAE's industrial future." },
      { property: "og:title", content: "What's YOUR dream job? — ADNOC at ADIPEC 2026" },
      { property: "og:description", content: "A few taps to find where you fit in the UAE's industrial future." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VotePage,
});

type Step = "welcome" | "choose" | "thanks";
const SUBMIT_TIMEOUT_MS = 12000;
export const QUESTION_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

function VotePage() {
  const service = getVotingService();
  const [step, setStep] = useState<Step>("welcome");
  const [question, setQuestion] = useState<Question | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultsSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AnswerOption | null>(null);
  const keyRef = useRef<{ optionId: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const mountedRef = useRef(false);
  const questionRef = useRef<Question | null>(null);
  const questionInFlightRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const loadQuestion = useCallback(
    (opts?: { manual?: boolean; resetBackoff?: boolean }) => {
      if (questionRef.current) {
        clearRetryTimer();
        return;
      }

      if (questionInFlightRef.current) {
        if (!opts?.manual) return;
        questionInFlightRef.current.abort();
        questionInFlightRef.current = null;
      }

      clearRetryTimer();
      if (opts?.manual || opts?.resetBackoff) {
        retryAttemptRef.current = 0;
      }
      if (opts?.manual) {
        setLoadError(null);
      }

      setLoadingQuestion(true);
      const ctrl = new AbortController();
      questionInFlightRef.current = ctrl;

      service
        .getActiveQuestion(ctrl.signal)
        .then((q) => {
          if (!mountedRef.current || questionInFlightRef.current !== ctrl) return;
          questionInFlightRef.current = null;
          clearRetryTimer();
          retryAttemptRef.current = 0;
          questionRef.current = q;
          setQuestion(q);
          setLoadError(null);
          setLoadingQuestion(false);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current || ctrl.signal.aborted || questionInFlightRef.current !== ctrl) return;
          questionInFlightRef.current = null;
          setLoadingQuestion(false);

          const code =
            err instanceof VoteError
              ? err.code
              : typeof navigator !== "undefined" && !navigator.onLine
                ? "NETWORK"
                : "SERVER";
          setLoadError(VOTE_ERROR_MESSAGES[code]);

          const attemptIndex = Math.min(retryAttemptRef.current, QUESTION_RETRY_DELAYS_MS.length - 1);
          const delayMs = QUESTION_RETRY_DELAYS_MS[attemptIndex]!;
          retryAttemptRef.current += 1;

          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (mountedRef.current && !questionRef.current) {
              loadQuestion();
            }
          }, delayMs);
        });
    },
    [service, clearRetryTimer],
  );

  useEffect(() => {
    mountedRef.current = true;
    loadQuestion({ resetBackoff: true });

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !questionRef.current) {
        loadQuestion({ resetBackoff: true });
      }
    };
    const onOnline = () => {
      if (!questionRef.current) {
        loadQuestion({ resetBackoff: true });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      if (questionInFlightRef.current) {
        questionInFlightRef.current.abort();
        questionInFlightRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, [loadQuestion, clearRetryTimer]);

  useEffect(() => {
    if (!question) return;
    const ctrl = new AbortController();
    service.getResults(question.id, ctrl.signal).then(setResults).catch(() => {});
    const unsub = service.subscribeResults(question.id, setResults);
    return () => {
      ctrl.abort();
      unsub();
    };
  }, [question, service]);

  const percentFor = (id: string) => results?.results.find((r) => r.optionId === id)?.percent ?? null;

  async function submit() {
    if (!question || !selectedId || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    // Reuse the same key while the visitor retries the same option, so retries can't double count.
    if (keyRef.current?.optionId !== selectedId) keyRef.current = { optionId: selectedId, key: newIdempotencyKey() };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await service.submitVote(
        { questionId: question.id, optionId: selectedId, idempotencyKey: keyRef.current.key },
        ctrl.signal,
      );
      const opt = question.options.find((o) => o.id === res.optionId) ?? null;
      setAccepted(opt);
      service.getResults(question.id).then(setResults).catch(() => {});
      keyRef.current = null;
      setStep("thanks");
    } catch (e) {
      const code = e instanceof VoteError ? e.code : typeof navigator !== "undefined" && !navigator.onLine ? "NETWORK" : "SERVER";
      setSubmitError(VOTE_ERROR_MESSAGES[code]);
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function goHome() {
    setSelectedId(null);
    setAccepted(null);
    setSubmitError(null);
    setStep("welcome");
  }

  const topOverlaySrc = step === "choose" ? votingTopOverlayUrl : step === "thanks" ? thankYouTopOverlayUrl : null;
  const bottomOverlaySrc = step === "choose" ? votingBottomOverlayUrl : step === "thanks" ? thankYouBottomOverlayUrl : null;

  return (
    <main className="mobile-stage">
      <BackgroundVideo blurred={step !== "welcome"} />
      {topOverlaySrc && (
        <img
          src={topOverlaySrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="mobile-overlay-top"
        />
      )}
      {bottomOverlaySrc && (
        <img
          src={bottomOverlaySrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="mobile-overlay-bottom"
        />
      )}
      <div className="mobile-frame">
        {step === "welcome" && (
          <Welcome
            onStart={() => {
              setStep("choose");
              if (!questionRef.current && !questionInFlightRef.current && retryTimerRef.current === null) {
                loadQuestion({ resetBackoff: true });
              }
            }}
          />
        )}

        {step === "choose" && (
          <>
            <TopBar onBack={() => setStep("welcome")} />
            <header className="mt-[26px] text-center">
              <p className="text-[16px] font-semibold">Tap your choice</p>
              <h1 className="mt-[14px] text-[28px] font-bold leading-[1.22] uppercase">
                Your future in
                <br />
                UAE industry
              </h1>
              <p className="mt-[14px] text-[16px] font-semibold">
                Which one is <span className="text-cyan">YOU?</span>
              </p>
            </header>

            {question ? (
              <div role="radiogroup" aria-label={question.prompt} className="mt-[22px] grid grid-cols-2 gap-x-[10.34px] gap-y-[11.14px]">
                {question.options.map((o) => (
                  <OptionCard
                    key={o.id}
                    option={o}
                    selected={selectedId === o.id}
                    percent={percentFor(o.id)}
                    disabled={submitting}
                    onSelect={() => {
                      setSelectedId(o.id);
                      setSubmitError(null);
                    }}
                  />
                ))}
              </div>
            ) : loadError ? (
              <div className="mt-10 text-center text-subtle" role="alert">
                <p>{loadError}</p>
                {loadingQuestion ? (
                  <p className="mt-3 text-[13px] opacity-80" aria-live="polite">
                    Checking again…
                  </p>
                ) : (
                  <button type="button" className="mt-3 underline" onClick={() => loadQuestion({ manual: true })}>
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-10 text-center text-subtle" aria-live="polite">Loading…</p>
            )}

            <div className="mt-auto pt-6">
              {submitError && (
                <p role="alert" className="mb-3 text-center text-[14px] font-medium text-subtle">
                  {submitError}
                </p>
              )}
              <PillButton disabled={!selectedId || submitting || !question} onClick={submit} aria-busy={submitting}>
                {submitting ? "Submitting…" : "Proceed"}
              </PillButton>
              <GrabberBar />
            </div>
          </>
        )}

        {step === "thanks" && accepted && (
          <>
            <TopBar onBack={goHome} />
            <section className="mt-[64px] flex flex-col items-center text-center">
              <div
                className="relative h-[108px] w-[120px] overflow-hidden pointer-events-none select-none"
                aria-hidden="true"
              >
                <img
                  src={thankYouFrameUrl}
                  alt=""
                  draggable={false}
                  className="absolute left-1/2 top-0 h-[499px] w-[345px] max-w-none -translate-x-1/2"
                />
              </div>
              <h1 className="mt-[6px] glow-text text-[50px] font-bold leading-[1.15] uppercase">
                Thank
                <br />
                you!
              </h1>
              <p className="text-[30px] font-normal leading-[1.2]">for taking part</p>
              <hr className="mt-[22px] w-[163px] border-t border-subtle/60" />
              <p className="mt-[18px] text-[13px] font-bold">Your choice has been submitted.</p>
              <p className="mt-[4px] text-[13px] leading-[1.5] text-subtle max-w-[220px]">
                We'll use it to show where you fit in the UAE's industrial future.
              </p>
            </section>
            <div className="mt-[40px]">
              <SelectedSummary option={accepted} percent={percentFor(accepted.id)} />
            </div>
            <div className="mt-auto pt-6">
              <PillButton onClick={goHome}>Back to home</PillButton>
              <GrabberBar />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <>
      <section className="mt-[162px] flex flex-col items-center text-center">
        <AdnocLogo className="h-[52px] w-[103px] object-contain" />
        <h1 className="mt-[34px] flex flex-col items-center font-bold leading-none">
          <span className="block text-[36.84px] leading-[47px]">What's</span>
          <img
            src={welcomeYourUrl}
            alt="YOUR"
            draggable={false}
            className="mt-[4px] w-[267px] max-w-full h-auto select-none"
          />
          <img
            src={welcomeDreamJobUrl}
            alt="dream job?"
            draggable={false}
            className="mt-[10px] w-[191px] max-w-full h-auto select-none"
          />
        </h1>
        <p className="mt-[24px]">
          <img
            src={welcomeSubtitleUrl}
            alt="A few taps to find where you fit in the UAE's industrial future."
            draggable={false}
            className="mx-auto w-[225px] max-w-full h-auto select-none"
          />
        </p>
      </section>
      <div className="mt-auto pt-8">
        <PillButton onClick={onStart}>Let's find out</PillButton>
        <GrabberBar />
      </div>
    </>
  );
}
