import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";

import logo from "@/assets/interim/adnoc-logo.png.asset.json";
import { OPTION_VISUALS } from "../presentation";
import type { AnswerOption } from "../types";

export function AdnocLogo({ className }: { className?: string }) {
  return <img src={logo.url} alt="ADNOC" className={className} draggable={false} />;
}

export function PillButton({
  children,
  ...props
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="pill-button" {...props}>
      <span>{children}</span>
      <span className="pill-arrow" aria-hidden>
        <ArrowRight size={24} strokeWidth={1.8} />
      </span>
    </button>
  );
}

export function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-start justify-between">
      <button type="button" className="glass-back" onClick={onBack} aria-label="Back">
        <ArrowLeft size={22} strokeWidth={2} />
      </button>
      <AdnocLogo className="h-[55px] w-auto -mt-[7px] -mr-[5px]" />
    </div>
  );
}

export function ProgressRow({ percent, className = "" }: { percent: number | null; className?: string }) {
  const p = percent ?? 0;
  return (
    <div className={`flex items-center gap-[18px] ${className}`}>
      <div className="progress-track flex-1" role="presentation">
        <div className="progress-fill" style={{ width: `${p}%` }} />
      </div>
      <span className="font-card text-[10.74px] font-bold min-w-[22px] text-right">
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
      <Icon size={20} strokeWidth={1.5} aria-hidden />
      <span className="mt-[13px] text-[13.13px] font-semibold leading-[1.3]">{option.label}</span>
      <span className="mt-[3px] text-[11.54px] leading-[1.35] text-subtle">{option.description}</span>
      <ProgressRow percent={percent} className="mt-auto pt-2" />
    </button>
  );
}

export function SelectedSummary({ option, percent }: { option: AnswerOption; percent: number | null }) {
  const Icon = OPTION_VISUALS[option.key].icon;
  return (
    <div className="option-card !min-h-0 !px-[17px] !pt-[18px] !pb-[16px] mx-[13px]">
      <div className="flex items-start gap-[18px]">
        <Icon size={22} strokeWidth={1.5} className="mt-[10px] flex-none" aria-hidden />
        <div className="flex-1">
          <div className="font-brand text-[15px] font-bold">{option.label}</div>
          <div className="text-[11.5px] text-subtle mt-[2px]">{option.description}</div>
        </div>
        <div className="flex items-center gap-[10px] mt-[6px]">
          <span className="grid place-items-center size-[14px] rounded-full bg-subtle text-accent">
            <Check size={10} strokeWidth={3} />
          </span>
          <span className="text-[10.5px] font-semibold">Done</span>
        </div>
      </div>
      <ProgressRow percent={percent} className="mt-[22px]" />
    </div>
  );
}
