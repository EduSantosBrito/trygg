const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const DIVISIONS: ReadonlyArray<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "seconds" },
  { amount: 60, unit: "minutes" },
  { amount: 24, unit: "hours" },
  { amount: 7, unit: "days" },
  { amount: 4.35, unit: "weeks" },
  { amount: 12, unit: "months" },
  { amount: Number.POSITIVE_INFINITY, unit: "years" },
];

/**
 * Format an ISO date string as a relative time (e.g., "5 minutes ago", "2 hours ago")
 */
export const formatRelative = (iso: string): string => {
  let seconds = (new Date(iso).getTime() - Date.now()) / 1000;

  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(seconds) < amount) {
      return rtf.format(Math.round(seconds), unit);
    }
    seconds /= amount;
  }

  return rtf.format(Math.round(seconds), "years");
};
