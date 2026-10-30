import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import adnocLogoUrl from "@/assets/Adnoc Logo.png";
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

export function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-start justify-between">
      <button type="button" className="glass-back" onClick={onBack} aria-label="Back">
        <ArrowLeft size={22} strokeWidth={2} />
      </button>
      <AdnocLogo className="h-[55px] w-[111px] object-contain -mt-[7px] -mr-[5px]" />
    </div>
  );
}

export function ProgressRow({ percent, className = "" }: { percent: number | null; className?: string }) {
  const p = percent ?? 0;
  return (
    <div className={`flex items-center gap-[9.55px] ${className}`}>
      <div className="progress-track flex-1" role="presentation">
        <div className="progress-fill" style={{ width: `${p}%` }} />
      </div>
      <span className="font-card text-[10.7419px] leading-[12px] font-bold w-[23.87px] flex-none text-right">
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
      className="option-card"
    >
      <Icon size={20.81} strokeWidth={1.5} aria-hidden className="flex-none" />
      <span className="mt-[8.6px] font-brand text-[13.129px] font-bold leading-[15px]">{option.label}</span>
      <span className="mt-[3.18px] font-brand text-[11.5376px] font-normal leading-[14px] text-subtle">{option.description}</span>
      <ProgressRow percent={percent} className="mt-auto pt-2" />
    </button>
  );
}

export function SelectedSummary({ option, percent }: { option: AnswerOption; percent: number | null }) {
  const Icon = OPTION_VISUALS[option.key].icon;
  return (
    <div className="option-card !min-h-0 !px-[17px] !pt-[18px] !pb-[16px] mx-[13px] font-summary">
      <div className="flex items-start gap-[18px]">
        <Icon size={22} strokeWidth={1.5} className="mt-[10px] flex-none" aria-hidden />
        <div className="flex-1">
          <div className="text-[15px] font-bold leading-[22px]">{option.label}</div>
          <div className="text-[11.5px] leading-[17px] text-[#CFE0FF] mt-[2px]">{option.description}</div>
        </div>
        <div className="flex items-center gap-[8px] mt-[6px]">
          <span className="grid place-items-center size-[14px] rounded-full bg-white/25 text-white">
            <Check size={10} strokeWidth={3} />
          </span>
          <span className="text-[11px] font-bold leading-[16px]">Done</span>
        </div>
      </div>
      <ProgressRow percent={percent} className="mt-[22px]" />
    </div>
  );
}
