import type { ReconSummary } from "@tieout/contracts";

/** Optional run summary to Slack. No webhook configured → quietly does nothing. */
export async function postSlackSummary(
  summary: ReconSummary,
  webhookUrl: string | undefined = process.env.SLACK_WEBHOOK_URL,
): Promise<boolean> {
  if (!webhookUrl) return false;
  const breakLines = Object.entries(summary.breaks)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `• ${type}: ${count}`);
  const text = [
    `Tieout recon run \`${summary.runId}\` (as of ${summary.asOf})`,
    `${summary.matches} matches, ${summary.totalBreaks} breaks`,
    ...breakLines,
  ].join("\n");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook responded ${response.status}`);
  }
  return true;
}
