import type { MicrosoftInvestment } from "./contracts";

/** Rolling window for Microsoft announcement counts. */
export const ANNOUNCEMENT_WINDOW_DAYS = 30;

/**
 * Status strings the roadmap feed uses for the three live phases, in
 * display order. Other feed statuses (for example "Cancelled") are kept
 * when a collected item actually has that status.
 */
export const ROADMAP_STATUS_ORDER = ["In development", "Rolling out", "Launched"] as const;

export const INVESTMENT_TITLE = "Microsoft investment";
export const INVESTMENT_LABEL = "Counts of Microsoft announcements, an indicator of Microsoft investment.";
export const NOT_AVAILABLE = "not available";

export function emptyMicrosoftInvestment(): MicrosoftInvestment {
  return {
    windowDays: ANNOUNCEMENT_WINDOW_DAYS,
    windowStart: null,
    windowEnd: null,
    asOf: null,
    messageCenter: { available: false },
    roadmap: { available: false },
  };
}

export function roadmapStatusCounts(counts: Record<string, number>): Record<string, number> {
  const ordered: Record<string, number> = {};
  for (const status of ROADMAP_STATUS_ORDER) ordered[status] = counts[status] ?? 0;
  const extras = Object.keys(counts).sort((left, right) => left.localeCompare(right));
  for (const status of extras) {
    if (Object.prototype.hasOwnProperty.call(ordered, status)) continue;
    const count = counts[status];
    if (typeof count === "number" && count > 0) ordered[status] = count;
  }
  return ordered;
}

type AnnouncementRow = {
  announcement_window_start?: string | null;
  announcement_window_end?: string | null;
  announcement_as_of?: string | null;
  announcement_message_center_count?: number | null;
  announcement_roadmap_count?: number | null;
  announcement_roadmap_status_json?: string | null;
};

export function microsoftInvestmentFromRow(row: AnnouncementRow | null | undefined): MicrosoftInvestment {
  const asOf = typeof row?.announcement_as_of === "string" ? row.announcement_as_of : null;
  if (!asOf) return emptyMicrosoftInvestment();
  return {
    windowDays: ANNOUNCEMENT_WINDOW_DAYS,
    windowStart: typeof row?.announcement_window_start === "string" ? row.announcement_window_start : null,
    windowEnd: typeof row?.announcement_window_end === "string" ? row.announcement_window_end : null,
    asOf,
    messageCenter: countOrUnavailable(row?.announcement_message_center_count),
    roadmap: roadmapOrUnavailable(row?.announcement_roadmap_count, row?.announcement_roadmap_status_json),
  };
}

function countOrUnavailable(count: unknown): MicrosoftInvestment["messageCenter"] {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return { available: false };
  return { available: true, count };
}

function roadmapOrUnavailable(count: unknown, statusJson: unknown): MicrosoftInvestment["roadmap"] {
  const total = countOrUnavailable(count);
  if (!total.available) return { available: false };
  const byStatus = parseStatusCounts(statusJson);
  if (!byStatus) return { available: false };
  return { available: true, count: total.count, byStatus };
}

function parseStatusCounts(statusJson: unknown): Record<string, number> | null {
  if (typeof statusJson !== "string" || !statusJson) return null;
  try {
    const parsed = JSON.parse(statusJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const counts: Record<string, number> = {};
    for (const [status, count] of Object.entries(parsed)) {
      const key = status.trim();
      if (!key || key.length > 80) return null;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
      counts[key] = count;
    }
    return counts;
  } catch {
    return null;
  }
}

export function formatInvestmentDate(iso: string | null): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(time));
}

export type InvestmentStatusLine = { status: string; value: string };

export type InvestmentView = {
  title: string;
  label: string;
  windowLabel: string;
  asOfLabel: string;
  messageCenter: string;
  roadmap: string;
  statuses: InvestmentStatusLine[];
};

export function investmentView(investment: MicrosoftInvestment | undefined): InvestmentView {
  const data = investment ?? emptyMicrosoftInvestment();
  const start = formatInvestmentDate(data.windowStart);
  const end = formatInvestmentDate(data.windowEnd);
  const asOf = formatInvestmentDate(data.asOf);
  const statuses = data.roadmap.available
    ? statusLines(data.roadmap.byStatus)
    : [];
  return {
    title: INVESTMENT_TITLE,
    label: INVESTMENT_LABEL,
    windowLabel: start && end ? `Last ${data.windowDays} days (${start} - ${end})` : `Last ${data.windowDays} days`,
    asOfLabel: asOf ? `As of ${asOf}` : `As of ${NOT_AVAILABLE}`,
    messageCenter: data.messageCenter.available ? String(data.messageCenter.count) : NOT_AVAILABLE,
    roadmap: data.roadmap.available ? String(data.roadmap.count) : NOT_AVAILABLE,
    statuses,
  };
}

function statusLines(byStatus: Record<string, number>): InvestmentStatusLine[] {
  const lines: InvestmentStatusLine[] = [];
  const seen = new Set<string>();
  for (const status of ROADMAP_STATUS_ORDER) {
    seen.add(status);
    lines.push({ status, value: String(byStatus[status] ?? 0) });
  }
  for (const status of Object.keys(byStatus).sort((left, right) => left.localeCompare(right))) {
    if (seen.has(status)) continue;
    lines.push({ status, value: String(byStatus[status] ?? 0) });
  }
  return lines;
}
