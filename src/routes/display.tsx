import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";

import adnocLogoUrl from "@/assets/display/Adnoc Logo 1 1.png";
import { BackgroundVideo } from "@/features/voting/components/MobileUI";
import { OPTION_VISUALS } from "@/features/voting/presentation";
import { getVotingService } from "@/features/voting/service";
import type { Question, ResultsSnapshot } from "@/features/voting/types";

export const Route = createFileRoute("/display")({
  head: () => ({
    meta: [
      { title: "Live results — Your future in UAE industry" },
      { name: "description", content: "Live ADIPEC 2026 voting results for the LED screen." },
      { property: "og:title", content: "Live results — Your future in UAE industry" },
      { property: "og:description", content: "Live ADIPEC 2026 voting results for the LED screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DisplayPage,
});

function useStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
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

function DisplayPage() {
  const service = getVotingService();
  const scale = useStageScale();
  const idle = useKioskHygiene();
  const [question, setQuestion] = useState<Question | null>(null);
  const [snap, setSnap] = useState<ResultsSnapshot | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};
    let retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const q = await service.getActiveQuestion();
        if (cancelled) return;
        setQuestion(q);
        setSnap(await service.getResults(q.id));
        setOffline(false);
        unsub();
        unsub = service.subscribeResults(q.id, setSnap);
      } catch {
        if (cancelled) return;
        setOffline(true);
        retry = setTimeout(load, 5000);
      }
    };
    load();
    // Fresh authoritative snapshot on reconnect / when the tab becomes visible again.
    const refresh = () => load();
    const onVis = () => document.visibilityState === "visible" && load();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      unsub();
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [service]);

  const maxPct = Math.max(1, ...(snap?.results.map((r) => r.percent) ?? [1]));

  return (
    <div
      className="led-viewport"
      style={{ cursor: idle ? "none" : "default" }}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      onClickCapture={(e) => e.preventDefault()}
    >
      <BackgroundVideo />
      <div className="led-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="led-overlay-top" aria-hidden="true" />
        <div className="led-overlay-bottom" aria-hidden="true" />

        <div className="led-glass absolute left-[88px] top-[87px] w-[273px] h-[122px] px-[36px] pt-[18px]">
          <div className="flex items-center gap-[16px]">
            <Users size={42} strokeWidth={1.6} className="text-cyan" />
            <span className="text-[47.56px] font-bold leading-none tabular-nums">
              {snap ? snap.totalVotes : "—"}
            </span>
          </div>
          <div className="mt-[12px] text-[23px] font-bold leading-none whitespace-nowrap">
            {offline ? "Reconnecting…" : "Responses so far"}
          </div>
        </div>

        <img
          src={adnocLogoUrl}
          alt="ADNOC"
          draggable={false}
          className="absolute right-[88px] top-[87px] w-[244px] h-[121px] object-contain"
        />

        <h1 className="absolute inset-x-0 top-[150px] text-center font-bold">
          <span className="block text-[60px] leading-[1.1]">Your future in UAE industry</span>
          <span className="block led-cyan-glow text-[60px] leading-[1.1] mt-[16px]">
            {question?.prompt ?? "Which one is YOU?"}
          </span>
        </h1>

        <div className="absolute left-[90px] right-[90px] top-[374px] flex justify-between">
          {(question?.options ?? []).map((o) => {
            const v = OPTION_VISUALS[o.key];
            const Icon = v.icon;
            const pct = snap?.results.find((r) => r.optionId === o.id)?.percent;
            const fill = pct === undefined ? 0 : pct / maxPct;
            return (
              <div key={o.id} className="led-card" data-expected-asset={v.expectedAssetFile}>
                {v.image && (
                  <img
                    src={v.image}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none select-none"
                    style={{ width: 378, height: 631, left: -60, top: -127 }}
                  />
                )}
                <div className="led-card-top" />
                <div className="relative pt-[14px] text-center">
                  <div className="text-[47.56px] font-bold leading-[1.15] tabular-nums transition-all">
                    {pct === undefined ? "—" : `${pct}%`}
                  </div>
                  <Segments fill={fill} />
                </div>
                <div className="led-card-label">
                  <span className="led-icon-ring">
                    <Icon size={26} strokeWidth={1.5} />
                  </span>
                  <span className="text-[19px] font-bold leading-[1.13]">
                    {v.ledLabel[0]}
                    {v.ledLabel[1] && (
                      <>
                        <br />
                        {v.ledLabel[1]}
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Three-segment cyan indicator from the LED reference; fill is relative to the leading option. */
function Segments({ fill }: { fill: number }) {
  return (
    <div className="mx-auto mt-[6px] flex w-[120px] gap-[5px]" aria-hidden>
      {[0, 1, 2].map((i) => {
        const part = Math.min(1, Math.max(0, fill * 3 - i));
        return (
          <div key={i} className="relative h-[5px] flex-1 overflow-hidden rounded-[2px] bg-[#12B8E3]/40">
            <div
              className="absolute inset-y-0 left-0 rounded-[2px] bg-cyan transition-[width] duration-700"
              style={{ width: `${part * 100}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
