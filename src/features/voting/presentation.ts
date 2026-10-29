import { Briefcase, Building2, Cpu, Factory, HardHat, Lightbulb, type LucideIcon } from "lucide-react";

import businessOwner from "@/assets/interim/business-owner.jpg.asset.json";
import dataAi from "@/assets/interim/data-ai.jpg.asset.json";
import industrialInvestor from "@/assets/interim/industrial-investor.jpg.asset.json";
import industrialSpecialist from "@/assets/interim/industrial-specialist.jpg.asset.json";
import privateSector from "@/assets/interim/private-sector.jpg.asset.json";
import somethingElse from "@/assets/interim/something-else.jpg.asset.json";
import type { OptionKey } from "./types";

// Visual assets per option. Images are INTERIM crops from the LED reference
// screenshot until the original card images are supplied. Icons are interim
// line icons until the supplied icon set arrives.
export const OPTION_VISUALS: Record<
  OptionKey,
  { icon: LucideIcon; image: string; ledLabel: [string, string?] }
> = {
  "business-owner": { icon: Briefcase, image: businessOwner.url, ledLabel: ["Business owner"] },
  "industrial-investor": { icon: Factory, image: industrialInvestor.url, ledLabel: ["Industrial", "investor"] },
  "private-sector": { icon: Building2, image: privateSector.url, ledLabel: ["Private-sector", "professional"] },
  "industrial-specialist": { icon: HardHat, image: industrialSpecialist.url, ledLabel: ["Industrial", "specialist"] },
  "data-ai": { icon: Cpu, image: dataAi.url, ledLabel: ["Data & AI", "in industry"] },
  "something-else": { icon: Lightbulb, image: somethingElse.url, ledLabel: ["Something else"] },
};
