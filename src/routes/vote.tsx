import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AdnocLogo,
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

function VotePage() {
  const service = getVotingService();
  const [step, setStep] = useState<Step>("welcome");
  const [question, setQuestion] = useState<Question | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultsSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AnswerOption | null>(null);
  const keyRef = useRef<{ optionId: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const loadQuestion = useCallback(() => {
    setLoadError(null);
    const ctrl = new AbortController();
    service
      .getActiveQuestion(ctrl.signal)
      .then(setQuestion)
      .catch(() => setLoadError(VOTE_ERROR_MESSAGES.QUESTION_UNAVAILABLE));
    return () => ctrl.abort();
  }, [service]);

  useEffect(() => loadQuestion(), [loadQuestion]);

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

  return (
    <main className="mobile-stage">
      <div className="mobile-frame">
        {step === "welcome" && <Welcome onStart={() => setStep("choose")} />}

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

            {loadError ? (
              <div className="mt-10 text-center text-subtle" role="alert">
                <p>{loadError}</p>
                <button type="button" className="mt-3 underline" onClick={loadQuestion}>
                  Try again
                </button>
              </div>
            ) : !question ? (
              <p className="mt-10 text-center text-subtle" aria-live="polite">Loading…</p>
            ) : (
              <div role="radiogroup" aria-label={question.prompt} className="mt-[22px] grid grid-cols-2 gap-x-[10px] gap-y-[10px]">
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
            </div>
          </>
        )}

        {step === "thanks" && accepted && (
          <>
            <TopBar onBack={goHome} />
            <section className="mt-[90px] flex flex-col items-center text-center">
              <div className="check-badge" aria-hidden>
                <Check size={30} strokeWidth={2.5} />
              </div>
              <h1 className="mt-[22px] glow-text text-[50px] font-bold leading-[1.15] uppercase">
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
            <div className="mt-[46px]">
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
      <section className="mt-[162px] flex flex-col items-center text-center">
        <AdnocLogo className="h-[52px] w-auto" />
        <h1 className="mt-[40px] font-bold leading-none">
          <span className="block text-[36.84px]">What's</span>
          <span className="block glow-text text-[95.34px] mt-[8px] leading-[1.05]">YOUR</span>
          <span className="block text-[36.84px] mt-[12px]">dream job?</span>
        </h1>
        <p className="mt-[30px] text-[13.61px] leading-[1.6] max-w-[245px]">
          A few taps to find where you fit in the UAE's industrial future.
        </p>
      </section>
      <div className="mt-auto pt-8">
        <PillButton onClick={onStart}>Let's find out</PillButton>
      </div>
    </>
  );
}
