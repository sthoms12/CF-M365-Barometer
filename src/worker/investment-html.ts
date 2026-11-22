import type { MicrosoftInvestment } from "../shared/contracts";
import { investmentView } from "../shared/investment";

export function investmentPanelHtml(
  investment: MicrosoftInvestment | undefined,
  escapeHtml: (value: string) => string,
  variant: "panel" | "compact",
): string {
  const view = investmentView(investment);
  if (variant === "compact") {
    const inlineStatuses = view.statuses.length
      ? `<div class="investment-status-inline" aria-label="Roadmap status breakdown">${view.statuses.map((line) => `<span>${escapeHtml(line.status)}: <strong>${escapeHtml(line.value)}</strong></span>`).join("")}</div>`
      : "";
    return `<div class="investment investment-compact" aria-label="${escapeHtml(view.title)}"><div class="investment-compact-row"><span class="investment-title">${escapeHtml(view.title)} (30d)</span><span class="investment-pill">Roadmap: <strong>${escapeHtml(view.roadmap)}</strong></span><span class="investment-pill">Message Center: <strong>${escapeHtml(view.messageCenter)}</strong></span></div>${inlineStatuses}</div>`;
  }
  const statuses = view.statuses.length
    ? `<ul>${view.statuses.map((line) => `<li><span>${escapeHtml(line.status)}</span><strong>${escapeHtml(line.value)}</strong></li>`).join("")}</ul>`
    : "";
  return `<div class="investment" aria-label="${escapeHtml(view.title)}"><h2>${escapeHtml(view.title)}</h2><p class="investment-note">${escapeHtml(view.label)}</p><p>${escapeHtml(view.windowLabel)}</p><p>${escapeHtml(view.asOfLabel)}</p><p>Roadmap: <strong>${escapeHtml(view.roadmap)}</strong></p>${statuses}<p>Message Center: <strong>${escapeHtml(view.messageCenter)}</strong></p></div>`;
}
