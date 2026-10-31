import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import adnocLogoUrl from "@/assets/Adnoc Logo.png";
import adnocVerticalCardUrl from "@/assets/welcome/adnoc_vertical_card.png";
import backgroundVideoUrl from "@/assets/background-video.mp4";
import mobileBgPosterUrl from "@/assets/voting/Asset 2@3x 2.png";
import grabberUrl from "@/assets/voting/Grabber.png";
import arrowRightUrl from "@/assets/welcome/arrow-right.png";
import { OPTION_VISUALS } from "../presentation";
import type { AnswerOption } from "../types";

export function BackgroundVideo({
  blurred = false,
  className = "",
}: {
  blurred?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const layerClass = `bg-video-layer ${blurred ? "bg-video-blurred" : ""} ${className}`;

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
        src={mobileBgPosterUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={layerClass}
      />
      <video
        ref={videoRef}
        src={backgroundVideoUrl}
        poster={mobileBgPosterUrl}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        className={layerClass}
      />
    </>
  );
}

export function AdnocLogo({ className }: { className?: string }) {
  return <img src={adnocLogoUrl} alt="ADNOC" className={className} draggable={false} />;
}

export function PillButton({
  children,
  ...props
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="pill-button" {...props}>
      <span>{children}</span>
      <img
        src={arrowRightUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pill-arrow-img"
      />
    </button>
  );
}

export function GrabberBar() {
  return (
    <img
      src={grabberUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="mx-auto mt-3 h-[4px] w-[116px] pointer-events-none select-none"
    />
  );
}

export function ChooseTopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="choose-header">
      <button
        type="button"
        className="glass-back !size-[clamp(34px,calc(42*var(--k)),42px)] !rounded-[clamp(10px,calc(14*var(--k)),14px)]"
        onClick={onBack}
        aria-label="Back"
      >
        <ArrowLeft
          size={22}
          strokeWidth={2}
          className="!size-[clamp(18px,calc(22*var(--k)),22px)]"
        />
      </button>
      <img
        src={adnocVerticalCardUrl}
        alt="ADNOC"
        draggable={false}
        className="h-[clamp(48px,calc(75*var(--k)),75px)] w-[clamp(32px,calc(49.7*var(--k)),49.7px)] object-contain select-none"
      />
    </div>
  );
}

export function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center justify-between flex-none h-[clamp(38px,calc(55*var(--k)),55px)]">
      <button
        type="button"
        className="glass-back !size-[clamp(34px,calc(42*var(--k)),42px)] !rounded-[clamp(10px,calc(14*var(--k)),14px)]"
        onClick={onBack}
        aria-label="Back"
      >
        <ArrowLeft
          size={22}
          strokeWidth={2}
          className="!size-[clamp(18px,calc(22*var(--k)),22px)]"
        />
      </button>
      <AdnocLogo className="h-[clamp(36px,calc(55*var(--k)),55px)] w-[clamp(72px,calc(111*var(--k)),111px)] object-contain -mr-[5px]" />
    </div>
  );
}

export function ProgressRow({
  percent,
  className = "",
  scaled = false,
}: {
  percent: number | null;
  className?: string;
  scaled?: boolean;
}) {
  const p = percent ?? 0;
  return (
    <div
      className={`flex items-center ${scaled ? "gap-[clamp(6px,calc(9.55*var(--k)),9.55px)]" : "gap-[9.55px]"} ${className}`}
    >
      <div className="progress-track flex-1" role="presentation">
        <div className="progress-fill" style={{ width: `${p}%` }} />
      </div>
      <span
        className={`font-card font-bold flex-none text-right ${
          scaled
            ? "text-[clamp(9px,calc(10.74*var(--k)),10.74px)] leading-[clamp(10px,calc(12*var(--k)),12px)] w-[clamp(18px,calc(23.87*var(--k)),23.87px)]"
            : "text-[10.7419px] leading-[12px] w-[23.87px]"
        }`}
      >
        {percent === null ? "–" : `${p}%`}
      </span>
    </div>
  );
}

export function OptionCard({
  option,
  selected,
  percent,
  onSelect,
  disabled,
}: {
  option: AnswerOption;
  selected: boolean;
  percent: number | null;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const Icon = OPTION_VISUALS[option.key].icon;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className="option-card option-card-fit"
    >
      <Icon
        size={20.81}
        strokeWidth={1.5}
        aria-hidden
        className="flex-none !size-[clamp(16px,calc(20.81*var(--k)),20.81px)]"
      />
      <span className="mt-[clamp(4px,calc(8.6*var(--k)),8.6px)] font-brand text-[clamp(10.5px,calc(13.13*var(--k)),13.13px)] font-bold leading-[clamp(12px,calc(15*var(--k)),15px)] line-clamp-1">
        {option.label}
      </span>
      <span className="mt-[clamp(2px,calc(3.18*var(--k)),3.18px)] font-brand text-[clamp(9px,calc(11.54*var(--k)),11.54px)] font-normal leading-[clamp(11px,calc(14*var(--k)),14px)] text-subtle line-clamp-2">
        {option.description}
      </span>
      <ProgressRow
        percent={percent}
        scaled
        className="mt-auto pt-[clamp(3px,calc(5*var(--k)),5px)]"
      />
    </button>
  );
}

export function SelectedSummary({
  option,
  percent,
}: {
  option: AnswerOption;
  percent: number | null;
}) {
  const Icon = OPTION_VISUALS[option.key]?.icon ?? OPTION_VISUALS["business-owner"].icon;
  return (
    <div className="option-card !min-h-0 !px-[clamp(10px,calc(17*var(--k)),17px)] !pt-[clamp(10px,calc(16*var(--k)),18px)] !pb-[clamp(10px,calc(14*var(--k)),16px)] mx-[clamp(4px,calc(13*var(--k)),13px)] font-summary">
      <div className="flex items-start gap-[clamp(8px,calc(16*var(--k)),18px)]">
        <Icon
          size={22}
          strokeWidth={1.5}
          className="mt-[clamp(2px,calc(6*var(--k)),10px)] flex-none !size-[clamp(18px,calc(22*var(--k)),22px)]"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-[clamp(13px,calc(15*var(--k)),15px)] font-bold leading-[clamp(18px,calc(22*var(--k)),22px)] truncate">
            {option.label}
          </div>
          <div className="text-[clamp(10px,calc(11.5*var(--k)),11.5px)] leading-[clamp(14px,calc(17*var(--k)),17px)] text-[#CFE0FF] mt-[2px] line-clamp-2">
            {option.description}
          </div>
        </div>
        <div className="flex items-center gap-[clamp(4px,calc(8*var(--k)),8px)] mt-[clamp(2px,calc(6*var(--k)),6px)] flex-none">
          <span className="grid place-items-center size-[clamp(12px,calc(14*var(--k)),14px)] rounded-full bg-white/25 text-white">
            <Check
              size={10}
              strokeWidth={3}
              className="!size-[clamp(8px,calc(10*var(--k)),10px)]"
            />
          </span>
          <span className="text-[clamp(9.5px,calc(11*var(--k)),11px)] font-bold leading-[16px]">
            Done
          </span>
        </div>
      </div>
      <ProgressRow percent={percent} className="mt-[clamp(10px,calc(20*var(--k)),22px)]" />
    </div>
  );
}
