import { useVisitorData } from "@fingerprint/react";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import thankYouFrameUrl from "@/assets/thank-you/Frame 1000011480.png";
import thankYouBottomOverlayUrl from "@/assets/thank-you/Rectangle 3.png";
import thankYouTopOverlayUrl from "@/assets/thank-you/Rectangle 4.png";
import votingBottomOverlayUrl from "@/assets/voting/Rectangle 3.png";
import votingTopOverlayUrl from "@/assets/voting/Rectangle 4.png";
import adnocVerticalCardUrl from "@/assets/welcome/adnoc_vertical_card.png";
import {
  AdnocLogo,
  BackgroundVideo,
  OptionCard,
  PillButton,
  ChooseTopBar,
  SelectedSummary,
  TopBar,
} from "@/features/voting/components/MobileUI";
import {
  getVotingService,
  newIdempotencyKey,
  VOTE_ERROR_MESSAGES,
} from "@/features/voting/service";
import {
  VoteError,
  type AnswerOption,
  type Question,
  type ResultsSnapshot,
} from "@/features/voting/types";

export const Route = createFileRoute("/vote")({
  head: () => ({
    meta: [
      { title: "What's YOUR dream job? — ADNOC at ADIPEC 2026" },
      {
        name: "description",
        content: "A few taps to find where you fit in the UAE's industrial future.",
      },
      { property: "og:title", content: "What's YOUR dream job? — ADNOC at ADIPEC 2026" },
      {
        property: "og:description",
        content: "A few taps to find where you fit in the UAE's industrial future.",
      },
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
  const {
    data: visitorData,
    error: fpError,
    getData: getVisitorData,
  } = useVisitorData({ immediate: true });

  const visitorDataRef = useRef(visitorData);
  visitorDataRef.current = visitorData;

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
    (opts?: { manual?: boolean; resetBackoff?: boolean; eventId?: string }) => {
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

      const activeEventId = opts?.eventId ?? visitorDataRef.current?.event_id;

      service
        .getActiveQuestion({ signal: ctrl.signal, eventId: activeEventId })
        .then((q) => {
          if (!mountedRef.current || questionInFlightRef.current !== ctrl) return;
          questionInFlightRef.current = null;
          clearRetryTimer();
          retryAttemptRef.current = 0;
          questionRef.current = q;
          setQuestion(q);
          if (q.hasVoted) {
            const opt = q.votedOption ?? q.options.find((o) => o.id === q.votedOption?.id) ?? null;
            if (opt) {
              setAccepted(opt);
            }
            setSubmitError(VOTE_ERROR_MESSAGES.ALREADY_VOTED);
            setStep((current) => (current === "choose" ? "thanks" : current));
          }
          setLoadError(null);
          setLoadingQuestion(false);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current || ctrl.signal.aborted || questionInFlightRef.current !== ctrl)
            return;
          questionInFlightRef.current = null;
          setLoadingQuestion(false);

          const code =
            err instanceof VoteError
              ? err.code
              : typeof navigator !== "undefined" && !navigator.onLine
                ? "NETWORK"
                : "SERVER";
          setLoadError(VOTE_ERROR_MESSAGES[code]);

          const attemptIndex = Math.min(
            retryAttemptRef.current,
            QUESTION_RETRY_DELAYS_MS.length - 1,
          );
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

  // Background check: when Fingerprint identification completes, detect if visitor has already voted
  useEffect(() => {
    const eventId = visitorData?.event_id;
    if (!eventId || service.isSimulated) return;
    if (questionRef.current?.hasVoted && (questionRef.current.votedOption || accepted)) return;

    service
      .getActiveQuestion({ eventId })
      .then((q) => {
        if (q.hasVoted) {
          const updated = { ...q, hasVoted: true };
          questionRef.current = updated;
          setQuestion(updated);
          const opt = q.votedOption ?? q.options.find((o) => o.id === q.votedOption?.id) ?? null;
          if (opt) {
            setAccepted(opt);
          }
          setSubmitError(VOTE_ERROR_MESSAGES.ALREADY_VOTED);
          setStep((currentStep) => {
            if (currentStep === "choose") {
              return "thanks";
            }
            return currentStep;
          });
        }
      })
      .catch(() => {});
  }, [visitorData?.event_id, accepted, service]);

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
    service
      .getResults(question.id, ctrl.signal)
      .then(setResults)
      .catch(() => {});
    const unsub = service.subscribeResults(question.id, setResults);
    return () => {
      ctrl.abort();
      unsub();
    };
  }, [question, service]);

  const percentFor = (id: string) =>
    results?.results.find((r) => r.optionId === id)?.percent ?? null;

  async function submit() {
    if (!question || !selectedId || inFlight.current) return;
    if (question.hasVoted) {
      setSubmitError(VOTE_ERROR_MESSAGES.ALREADY_VOTED);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);

    let eventId = visitorData?.event_id;
    if (!eventId && !fpError) {
      try {
        const fresh = await getVisitorData();
        eventId = fresh?.event_id;
      } catch {
        // Handled below if eventId remains empty
      }
    }

    if (!eventId && !service.isSimulated) {
      inFlight.current = false;
      setSubmitting(false);
      setSubmitError(
        "Device verification is temporarily unavailable. Please check your connection and try again.",
      );
      return;
    }

    // Reuse the same key while the visitor retries the same option, so retries can't double count.
    if (keyRef.current?.optionId !== selectedId)
      keyRef.current = { optionId: selectedId, key: newIdempotencyKey() };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await service.submitVote(
        {
          questionId: question.id,
          optionId: selectedId,
          idempotencyKey: keyRef.current.key,
          fingerprintEventId: eventId,
        },
        ctrl.signal,
      );
      const opt = question.options.find((o) => o.id === res.optionId) ?? null;
      setAccepted(opt);
      if (!service.isSimulated) {
        const updatedQuestion: Question = { ...question, hasVoted: true, votedOption: opt };
        questionRef.current = updatedQuestion;
        setQuestion(updatedQuestion);
        setSubmitError(VOTE_ERROR_MESSAGES.ALREADY_VOTED);
      }
      service
        .getResults(question.id)
        .then(setResults)
        .catch(() => {});
      keyRef.current = null;
      setStep("thanks");
    } catch (e) {
      if (e instanceof VoteError && e.code === "ALREADY_VOTED") {
        const updatedQuestion = { ...question, hasVoted: true };
        questionRef.current = updatedQuestion;
        setQuestion(updatedQuestion);
        const activeEventId = visitorDataRef.current?.event_id;
        service
          .getActiveQuestion({ eventId: activeEventId })
          .then((q) => {
            const prevOpt =
              q.votedOption ?? q.options.find((o) => o.id === q.votedOption?.id) ?? null;
            if (prevOpt) {
              setAccepted(prevOpt);
              setStep("thanks");
            }
          })
          .catch(() => {});
      }
      const code =
        e instanceof VoteError
          ? e.code
          : typeof navigator !== "undefined" && !navigator.onLine
            ? "NETWORK"
            : "SERVER";
      setSubmitError(VOTE_ERROR_MESSAGES[code]);
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function goHome() {
    setSelectedId(null);
    if (!questionRef.current?.hasVoted) {
      setAccepted(null);
      setSubmitError(null);
    }
    setStep("welcome");
  }

  const topOverlaySrc =
    step === "choose" ? votingTopOverlayUrl : step === "thanks" ? thankYouTopOverlayUrl : null;
  const bottomOverlaySrc =
    step === "choose"
      ? votingBottomOverlayUrl
      : step === "thanks"
        ? thankYouBottomOverlayUrl
        : null;

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
      <div className={`mobile-frame ${step === "choose" ? "mobile-frame-fit" : ""}`}>
        {step === "welcome" && (
          <Welcome
            onStart={() => {
              const q = questionRef.current;
              if (q?.hasVoted) {
                const opt =
                  q.votedOption ?? accepted ?? q.options.find((o) => o.id === q.votedOption?.id);
                if (opt) {
                  setAccepted(opt);
                }
                if (q.id) {
                  service
                    .getResults(q.id)
                    .then(setResults)
                    .catch(() => {});
                }
                setStep("thanks");
                return;
              }

              setStep("choose");
              if (
                !questionRef.current &&
                !questionInFlightRef.current &&
                retryTimerRef.current === null
              ) {
                loadQuestion({ resetBackoff: true });
              }
            }}
          />
        )}

        {step === "choose" && (
          <>
            <ChooseTopBar onBack={() => setStep("welcome")} />
            <header className="choose-intro">
              <p className="text-[calc(16*var(--k))] font-semibold leading-[calc(16*var(--k))]">
                Tap your choice
              </p>
              <h1 className="mt-[calc(15*var(--k))] text-[calc(27*var(--k))] font-bold leading-[calc(34*var(--k))] uppercase">
                Your future in
                <br />
                UAE industry
              </h1>
              <p className="mt-[calc(16*var(--k))] text-[calc(16*var(--k))] font-semibold leading-[calc(20*var(--k))]">
                Which one is <span className="text-cyan">YOU?</span>
              </p>
            </header>

            {question ? (
              <div role="radiogroup" aria-label={question.prompt} className="choose-grid">
                {question.options.map((o) => (
                  <OptionCard
                    key={o.id}
                    option={o}
                    selected={selectedId === o.id}
                    percent={percentFor(o.id)}
                    disabled={submitting}
                    onSelect={() => {
                      setSelectedId(o.id);
                      if (!question.hasVoted) {
                        setSubmitError(null);
                      }
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
                  <button
                    type="button"
                    className="mt-3 underline"
                    onClick={() => loadQuestion({ manual: true })}
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-10 text-center text-subtle" aria-live="polite">
                Loading…
              </p>
            )}

            <div className="choose-footer">
              {submitError && (
                <p role="alert" className="mb-3 text-center text-[14px] font-medium text-subtle">
                  {submitError}
                </p>
              )}
              <PillButton
                disabled={!selectedId || submitting || !question || Boolean(question.hasVoted)}
                onClick={submit}
                aria-busy={submitting}
              >
                {submitting ? "Submitting…" : "Proceed"}
              </PillButton>
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
      <section className="mt-[96px] flex flex-col items-center text-center">
        <img
          src={adnocVerticalCardUrl}
          alt="ADNOC"
          draggable={false}
          className="h-[112px] w-[74px] object-contain select-none drop-shadow-[0_0_1px_rgba(255,255,255,0.4)]"
        />
        <h1 className="mt-[34px] flex flex-col items-center select-none">
          <span className="font-brand text-[36.84px] font-bold leading-[47px] tracking-[-0.01em] text-white">
            What's
          </span>
          <span className="welcome-your font-brand text-[95.34px] font-extrabold leading-[108px] tracking-[-0.02em] text-white">
            YOUR
          </span>
          <span className="font-brand text-[36.84px] font-bold leading-[47px] tracking-[-0.01em] text-white">
            dream job?
          </span>
        </h1>
        <p className="mt-[24px] max-w-[260px] font-brand text-[13.61px] font-normal leading-[17px] text-white text-center">
          A few taps to find where you fit in the
          <br />
          UAE's industrial future.
        </p>
      </section>
      <div className="mt-auto pt-6">
        <PillButton onClick={onStart}>Let's find out</PillButton>
      </div>
    </>
  );
}
