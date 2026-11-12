import type { MicrosoftInvestment } from "../shared/contracts";
import { investmentView } from "../shared/investment";

export function investmentPanelHtml(
  investment: MicrosoftInvestment | undefined,
  escapeHtml: (value: string) => string,
  variant: "panel" | "compact",
): string {
  const view = investmentView(investment);
  const title = variant === "compact"
    ? `<p class="investment-title">${escapeHtml(view.title)}</p>`
    : `<h2>${escapeHtml(view.title)}</h2>`;
  const statuses = view.statuses.length
    ? `<ul>${view.statuses.map((line) => `<li><span>${escapeHtml(line.status)}</span><strong>${escapeHtml(line.value)}</strong></li>`).join("")}</ul>`
    : "";
  const compact = variant === "compact" ? " investment-compact" : "";
  return `<div class="investment${compact}" aria-label="${escapeHtml(view.title)}">${title}<p class="investment-note">${escapeHtml(view.label)}</p><p>${escapeHtml(view.windowLabel)}</p><p>${escapeHtml(view.asOfLabel)}</p><p>Roadmap: <strong>${escapeHtml(view.roadmap)}</strong></p>${statuses}<p>Message Center: <strong>${escapeHtml(view.messageCenter)}</strong></p></div>`;
}
