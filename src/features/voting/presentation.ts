import {
  Briefcase,
  Building2,
  Cpu,
  Factory,
  HardHat,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

import type { OptionKey } from "./types";

/**
 * Visual metadata per option key (`icon_key` in PostgreSQL).
 */
export const OPTION_VISUALS: Record<
  OptionKey,
  {
    icon: LucideIcon;
    image: string | null;
    expectedAssetFile: string;
    ledLabel: [string, string?];
  }
> = {
  "business-owner": {
    icon: Briefcase,
    image: null,
    expectedAssetFile: "src/assets/business-owner.jpg",
    ledLabel: ["Entrepreneur"],
  },
  "industrial-investor": {
    icon: Factory,
    image: null,
    expectedAssetFile: "src/assets/industrial-investor.jpg",
    ledLabel: ["Technology", "innovator"],
  },
  "private-sector": {
    icon: Building2,
    image: null,
    expectedAssetFile: "src/assets/private-sector.jpg",
    ledLabel: ["Private-sector", "professional"],
  },
  "industrial-specialist": {
    icon: HardHat,
    image: null,
    expectedAssetFile: "src/assets/industrial-specialist.jpg",
    ledLabel: ["Industrial", "specialist"],
  },
  "data-ai": {
    icon: Cpu,
    image: null,
    expectedAssetFile: "src/assets/data-ai.jpg",
    ledLabel: ["Data & AI", "in industry"],
  },
  "something-else": {
    icon: Lightbulb,
    image: null,
    expectedAssetFile: "src/assets/something-else.jpg",
    ledLabel: ["Something else"],
  },
};
