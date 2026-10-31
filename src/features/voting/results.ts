import type { OptionResult } from "./types";

/**
 * Whole-number percentages from accepted vote counts using the largest-remainder
 * method so the displayed values always add up to exactly 100 (or all 0 with no votes).
 */
export function computeResults(counts: { optionId: string; count: number }[]): {
  totalVotes: number;
  results: OptionResult[];
} {
  const totalVotes = counts.reduce((s, c) => s + Math.max(0, c.count), 0);
  if (totalVotes === 0) {
    return {
      totalVotes,
      results: counts.map((c) => ({ optionId: c.optionId, count: 0, percent: 0 })),
    };
  }
  const raw = counts.map((c) => {
    const exact = (Math.max(0, c.count) / totalVotes) * 100;
    return { ...c, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let leftover = 100 - raw.reduce((s, r) => s + r.floor, 0);
  const order = raw.map((r, i) => i).sort((a, b) => raw[b]!.rem - raw[a]!.rem || a - b);
  const bonus = new Set<number>();
  for (const i of order) {
    if (leftover <= 0) break;
    bonus.add(i);
    leftover--;
  }
  return {
    totalVotes,
    results: raw.map((r, i) => ({
      optionId: r.optionId,
      count: Math.max(0, r.count),
      percent: r.floor + (bonus.has(i) ? 1 : 0),
    })),
  };
}
