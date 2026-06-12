export type AiQuotaStatus = {
  limited: boolean;
  resetAt: string | null;
  message: string | null;
};

const quotaPatterns = [
  /daily.*(?:quota|limit|allocation)/i,
  /(?:quota|limit|allocation).*daily/i,
  /neurons?.*(?:exceeded|limit|quota|allocation)/i,
  /(?:exceeded|limit|quota|allocation).*neurons?/i,
  /free tier.*(?:exceeded|limit|quota|allocation)/i,
  /(?:run out|exhausted|exceeded|reached).*(?:free|daily|neurons?).*(?:usage|allocation|quota|limit)/i,
];

export function isAiDailyQuotaError(error: unknown): boolean {
  let message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  if (typeof error === "object" && error !== null) {
    try {
      message += ` ${JSON.stringify(error)}`;
    } catch {
      // Use the string representation when the error object is not serializable.
    }
  }
  return quotaPatterns.some((pattern) => pattern.test(message));
}

export async function markAiQuotaExceeded(db: D1Database, runId: string): Promise<void> {
  await db.prepare(`
    UPDATE analysis_runs SET status = 'failed', completed_at = ?,
      error_code = 'AI_QUOTA_EXCEEDED',
      error_message = 'Workers AI daily free-tier limit reached. Analysis resumes after the UTC daily reset.'
    WHERE id = ?
  `).bind(new Date().toISOString(), runId).run();
}

export async function getAiQuotaStatus(db: D1Database): Promise<AiQuotaStatus> {
  const run = await db.prepare(`
    SELECT error_message FROM analysis_runs
    WHERE error_code = 'AI_QUOTA_EXCEEDED'
      AND completed_at >= datetime('now', 'start of day')
    ORDER BY completed_at DESC LIMIT 1
  `).first<{ error_message: string | null }>();

  if (!run) return { limited: false, resetAt: null, message: null };
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return {
    limited: true,
    resetAt: resetAt.toISOString(),
    message: run.error_message,
  };
}
