import type { SupplyDemandScore } from "../shared/contracts";

/** Weeks of a product's own history used for the 0–100 percentile. */
export const HISTORY_WEEKS = 26;
/** Fewer stored weeks than this makes an index an estimate. */
export const MIN_WEEKS_FOR_FULL_INDEX = 4;
/** A source joins the index after this many non-null weeks for the product. */
export const MIN_SOURCE_WEEKS = 4;
/** Hot / Neutral / Cold needs this many sources in the scored week. */
export const MIN_SOURCES_FOR_LABEL = 3;

export type SignalKind = "supply" | "demand";

export type ProductSignalProfile = {
  slug: string;
  /** Exact message-center Services values and roadmap product tags. */
  services: string[];
  /** Case-insensitive title phrases. Short or broad product names stay out of this list. */
  titlePhrases: string[];
  /** en.wikipedia article title, or null when no dedicated article exists. */
  wikipediaTitle: string | null;
  /** True when the article is broader than this catalog row. */
  wikipediaEstimated: boolean;
  hnQuery: string;
};

/**
 * Curated match rules for the seeded catalog.
 * Message Center service names are not marketing names, and several products
 * share a parent service such as Microsoft Teams or Outlook. Those use title
 * phrases instead of the parent service.
 */
export const PRODUCT_SIGNAL_MAP: readonly ProductSignalProfile[] = [
  {
    slug: "new-outlook",
    services: [],
    titlePhrases: ["new outlook", "outlook for windows"],
    wikipediaTitle: "Outlook_for_Windows",
    wikipediaEstimated: false,
    hnQuery: '"new Outlook" OR "Outlook for Windows"',
  },
  {
    slug: "microsoft-365-copilot",
    services: ["Microsoft Copilot (Microsoft 365)"],
    titlePhrases: ["microsoft 365 copilot", "m365 copilot", "copilot for microsoft 365"],
    wikipediaTitle: "Microsoft_Copilot",
    wikipediaEstimated: true,
    hnQuery: '"Microsoft 365 Copilot"',
  },
  {
    slug: "copilot-chat",
    services: ["Microsoft 365 Copilot Chat"],
    titlePhrases: ["copilot chat"],
    wikipediaTitle: null,
    wikipediaEstimated: false,
    hnQuery: '"Copilot Chat" Microsoft',
  },
  {
    slug: "teams-premium",
    services: [],
    titlePhrases: ["teams premium"],
    wikipediaTitle: null,
    wikipediaEstimated: false,
    hnQuery: '"Teams Premium"',
  },
  {
    slug: "teams-phone",
    services: [],
    titlePhrases: ["teams phone", "teams calling"],
    wikipediaTitle: null,
    wikipediaEstimated: false,
    hnQuery: '"Teams Phone" OR "Teams Calling"',
  },
  {
    slug: "microsoft-loop",
    services: [],
    titlePhrases: ["microsoft loop", "loop components"],
    wikipediaTitle: "Microsoft_Loop",
    wikipediaEstimated: false,
    hnQuery: '"Microsoft Loop"',
  },
  {
    slug: "microsoft-planner",
    services: ["Planner"],
    titlePhrases: ["microsoft planner"],
    wikipediaTitle: "Microsoft_Planner",
    wikipediaEstimated: false,
    hnQuery: '"Microsoft Planner"',
  },
  {
    slug: "microsoft-lists",
    services: [],
    titlePhrases: ["microsoft lists"],
    wikipediaTitle: null,
    wikipediaEstimated: false,
    hnQuery: '"Microsoft Lists"',
  },
  {
    slug: "sharepoint-agents",
    services: [],
    titlePhrases: ["sharepoint agents", "agents in sharepoint", "sharepoint: agent", "sharepoint page agent"],
    wikipediaTitle: null,
    wikipediaEstimated: false,
    hnQuery: '"SharePoint agents" OR "agents in SharePoint"',
  },
  {
    slug: "microsoft-intune",
    services: ["Microsoft Intune"],
    titlePhrases: ["microsoft intune", "intune suite"],
    wikipediaTitle: "Microsoft_Intune",
    wikipediaEstimated: false,
    hnQuery: '"Microsoft Intune"',
  },
  {
    slug: "microsoft-entra",
    services: ["Microsoft Entra", "Microsoft Entra ID (formerly Azure AD)"],
    titlePhrases: ["microsoft entra", "entra id"],
    wikipediaTitle: "Microsoft_Entra_ID",
    wikipediaEstimated: true,
    hnQuery: '"Microsoft Entra" OR "Entra ID"',
  },
];

const BY_SLUG = new Map(PRODUCT_SIGNAL_MAP.map((profile) => [profile.slug, profile]));

export function catalogProfile(slug: string): ProductSignalProfile | undefined {
  return BY_SLUG.get(slug);
}

export type SourceConfig = {
  wikipediaTitle?: string | null;
  wikipediaEstimated?: boolean;
  hnQuery?: string;
};

export type ResolvedSignalProfile = {
  services: string[];
  phrases: string[];
  wikipediaTitle: string | null;
  wikipediaEstimated: boolean;
  hnQuery: string;
};

export function resolveSignalProfile(input: {
  slug: string;
  name: string;
  aliases: string[];
  sourceConfig: SourceConfig;
}): ResolvedSignalProfile {
  const catalog = catalogProfile(input.slug);
  const phrases = new Set<string>();
  const addPhrase = (value: string) => {
    const phrase = value.trim().toLowerCase();
    if (phrase.length >= 4) phrases.add(phrase);
  };
  addPhrase(input.name);
  for (const alias of input.aliases) addPhrase(alias);
  for (const phrase of catalog?.titlePhrases ?? []) addPhrase(phrase);

  const wikipediaTitle = input.sourceConfig.wikipediaTitle === undefined
    ? catalog?.wikipediaTitle ?? null
    : input.sourceConfig.wikipediaTitle;
  const wikipediaEstimated = input.sourceConfig.wikipediaEstimated
    ?? (wikipediaTitle ? catalog?.wikipediaEstimated ?? false : false);

  return {
    services: (catalog?.services ?? []).map((service) => service.toLowerCase()),
    phrases: [...phrases],
    wikipediaTitle: wikipediaTitle || null,
    wikipediaEstimated,
    hnQuery: input.sourceConfig.hnQuery?.trim() || catalog?.hnQuery || `"${input.name}"`,
  };
}

export type CatalogItem = {
  id: string;
  title: string;
  services: string[];
  at: string | null;
  major?: boolean;
};

export function itemMatches(item: CatalogItem, profile: Pick<ResolvedSignalProfile, "services" | "phrases">): boolean {
  const services = item.services.map((service) => service.toLowerCase());
  if (profile.services.some((service) => services.includes(service))) return true;
  const title = item.title.toLowerCase();
  return profile.phrases.some((phrase) => title.includes(phrase));
}

export function isoWeekStart(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

export function shiftWeek(week: string, deltaWeeks: number): string {
  const date = new Date(`${week}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaWeeks * 7);
  return date.toISOString().slice(0, 10);
}

export function lastCompletedWeek(now: Date): string {
  return shiftWeek(isoWeekStart(now), -1);
}

export function weekSequence(endWeek: string, count: number): string[] {
  const weeks: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) weeks.push(shiftWeek(endWeek, -offset));
  return weeks;
}

export function isMonday(week: string): boolean {
  const date = new Date(`${week}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === week && date.getUTCDay() === 1;
}

export function timestampInWeek(iso: string, week: string): boolean {
  const time = Date.parse(iso);
  const start = Date.parse(`${week}T00:00:00.000Z`);
  return !Number.isNaN(time) && time >= start && time < start + 7 * 86_400_000;
}

export type ScoreSignal = {
  week: string;
  source: string;
  kind: SignalKind;
  value: number;
  estimated?: boolean;
};

export function emptySupplyDemand(): SupplyDemandScore {
  return {
    week: null,
    supply: null,
    demand: null,
    gap: null,
    momentum: null,
    label: null,
    confidence: "not enough data",
    sources: 0,
    status: "not_enough_data",
    estimated: false,
    pendingSources: [],
  };
}

export function scoreSupplyDemand(signals: readonly ScoreSignal[], now: Date): SupplyDemandScore {
  const currentWeek = isoWeekStart(now);
  const recorded = signals.filter((signal) =>
    signal.week && signal.week <= currentWeek && (signal.kind === "supply" || signal.kind === "demand"),
  );
  if (recorded.length === 0) return emptySupplyDemand();

  const pendingSources = listPendingSources(recorded);
  const pending = new Set(pendingSources.map((entry) => entry.source));
  const usable = recorded.filter((signal) => !pending.has(signal.source));
  if (usable.length === 0) return { ...emptySupplyDemand(), pendingSources };

  const completedWeek = shiftWeek(currentWeek, -1);
  const weeks = [...new Set(usable.map((signal) => signal.week))].sort();
  const completed = weeks.filter((week) => week <= completedWeek);
  const scoreWeek = completed.at(-1) ?? weeks.at(-1);
  if (!scoreWeek) return { ...emptySupplyDemand(), pendingSources };
  const partial = scoreWeek === currentWeek;

  const windowStart = shiftWeek(scoreWeek, -(HISTORY_WEEKS - 1));
  const inWindow = usable.filter((signal) => signal.week >= windowStart && signal.week <= scoreWeek);
  const supply = indexFor(inWindow, "supply", scoreWeek, partial);
  const demandWeeks = weeklyTotals(inWindow, "demand");
  const demand = indexFor(inWindow, "demand", scoreWeek, partial);
  const heats = demandHeats(demandWeeks);
  const currentHeat = heats.get(scoreWeek);
  const priorHeats = [...heats.entries()]
    .filter(([week]) => week < scoreWeek)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-4)
    .map(([, heat]) => heat);
  const momentum = currentHeat === undefined || priorHeats.length === 0
    ? null
    : Math.round(currentHeat - priorHeats.reduce((sum, heat) => sum + heat, 0) / priorHeats.length);

  const sources = new Set(inWindow.filter((signal) => signal.week === scoreWeek).map((signal) => signal.source)).size;
  const confidence = sources === 0
    ? "not enough data"
    : sources < MIN_SOURCES_FOR_LABEL
      ? "Low"
      : sources < 5
        ? "Medium"
        : "High";
  const label = demand && momentum !== null && sources >= MIN_SOURCES_FOR_LABEL && demand.weeks >= MIN_WEEKS_FOR_FULL_INDEX
    ? labelFor(demand.index, momentum)
    : null;
  const gap = supply && demand ? demand.index - supply.index : null;
  const estimated = Boolean(supply?.estimated || demand?.estimated);

  return {
    week: scoreWeek,
    supply,
    demand,
    gap,
    momentum,
    label,
    confidence,
    sources,
    status: label ? "ok" : "not_enough_data",
    estimated: Boolean(label && estimated) || Boolean(gap !== null && estimated),
    pendingSources,
  };
}

function listPendingSources(signals: readonly ScoreSignal[]): SupplyDemandScore["pendingSources"] {
  const weeks = new Map<string, Set<string>>();
  for (const signal of signals) {
    if (typeof signal.value !== "number" || Number.isNaN(signal.value)) continue;
    const seen = weeks.get(signal.source) ?? new Set<string>();
    seen.add(signal.week);
    weeks.set(signal.source, seen);
  }
  return [...weeks]
    .filter(([, seen]) => seen.size < MIN_SOURCE_WEEKS)
    .map(([source, seen]) => ({ source, weeks: seen.size }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

function labelFor(heat: number, momentum: number): SupplyDemandScore["label"] {
  if (heat >= 70 && momentum > 0) return "Hot";
  if (heat <= 30 && momentum < 0) return "Cold";
  return "Neutral";
}

function indexFor(
  signals: readonly ScoreSignal[],
  kind: SignalKind,
  scoreWeek: string,
  partial: boolean,
): SupplyDemandScore["supply"] {
  const totals = weeklyTotals(signals, kind);
  const raw = totals.get(scoreWeek);
  if (raw === undefined) return null;
  const history = [...totals.entries()]
    .filter(([week]) => week <= scoreWeek)
    .map(([, value]) => value);
  const estimated = partial
    || history.length < MIN_WEEKS_FOR_FULL_INDEX
    || signals.some((signal) => signal.kind === kind && signal.week === scoreWeek && signal.estimated);
  return {
    index: percentile(raw, history),
    raw,
    weeks: history.length,
    estimated,
  };
}

function weeklyTotals(signals: readonly ScoreSignal[], kind: SignalKind): Map<string, number> {
  const totals = new Map<string, number>();
  for (const signal of signals) {
    if (signal.kind !== kind) continue;
    totals.set(signal.week, (totals.get(signal.week) ?? 0) + signal.value);
  }
  return totals;
}

function demandHeats(totals: Map<string, number>): Map<string, number> {
  const weeks = [...totals.keys()].sort();
  const heats = new Map<string, number>();
  for (const week of weeks) {
    const history = weeks.filter((candidate) => candidate <= week && candidate >= shiftWeek(week, -(HISTORY_WEEKS - 1)));
    const values = history.map((candidate) => totals.get(candidate) ?? 0);
    heats.set(week, percentile(totals.get(week) ?? 0, values));
  }
  return heats;
}

export function percentile(current: number, values: readonly number[]): number {
  if (values.length === 0) return 0;
  const below = values.filter((value) => value < current).length;
  const equal = values.filter((value) => value === current).length;
  return Math.round(((below + equal * 0.5) / values.length) * 100);
}

export function sumPageviewsByWeek(
  items: readonly { timestamp: string; views: number }[],
  weeks: readonly string[],
): Map<string, number> {
  const totals = new Map(weeks.map((week) => [week, 0]));
  for (const item of items) {
    if (item.timestamp.length < 8) continue;
    const day = `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`;
    const week = isoWeekStart(new Date(`${day}T00:00:00.000Z`));
    if (!totals.has(week)) continue;
    totals.set(week, (totals.get(week) ?? 0) + item.views);
  }
  return totals;
}

export function countHitsByWeek(createdAtSeconds: readonly number[], weeks: readonly string[]): Map<string, number> {
  const totals = new Map(weeks.map((week) => [week, 0]));
  for (const seconds of createdAtSeconds) {
    const week = isoWeekStart(new Date(seconds * 1000));
    if (!totals.has(week)) continue;
    totals.set(week, (totals.get(week) ?? 0) + 1);
  }
  return totals;
}
