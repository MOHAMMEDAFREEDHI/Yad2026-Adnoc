import { Briefcase, Building2, Cpu, Factory, HardHat, Lightbulb, type LucideIcon } from "lucide-react";

import type { OptionKey } from "./types";
import imgBusiness from "@/assets/display/Poll option (4).png";
import imgInvestor from "@/assets/display/Poll option (3).png";
import imgPrivate from "@/assets/display/Poll option (2).png";
import imgSpecialist from "@/assets/display/Poll option (1).png";
import imgDataAi from "@/assets/display/Poll option.png";

/**
 * Visual assets per option.
 * Original LED card portrait assets are pending delivery and intentionally set to `null`
 * (replacing broken `/__l5e/assets-v1/...` Lovable cloud pointers).
 * When the original files are supplied in `src/assets/`, import them here and assign to `image`.
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
    image: imgBusiness,
    expectedAssetFile: "src/assets/business-owner.jpg",
    ledLabel: ["Business owner"],
  },
  "industrial-investor": {
    icon: Factory,
    image: imgInvestor,
    expectedAssetFile: "src/assets/industrial-investor.jpg",
    ledLabel: ["Industrial", "investor"],
  },
  "private-sector": {
    icon: Building2,
    image: imgPrivate,
    expectedAssetFile: "src/assets/private-sector.jpg",
    ledLabel: ["Private-sector", "professional"],
  },
  "industrial-specialist": {
    icon: HardHat,
    image: imgSpecialist,
    expectedAssetFile: "src/assets/industrial-specialist.jpg",
    ledLabel: ["Industrial", "specialist"],
  },
  "data-ai": {
    icon: Cpu,
    image: imgDataAi,
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
