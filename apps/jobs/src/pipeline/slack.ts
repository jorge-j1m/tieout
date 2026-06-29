import type { ReconSummary } from "@tieout/contracts";

/**
 * Optional run summary to Slack. No webhook configured → quietly does nothing.
 * Delivery failures are logged, never thrown: the run is already persisted, and
 * failing the task over a courtesy notification would make the retry record a
 * duplicate run.
 */
export async function postSlackSummary(summary: ReconSummary): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return false;
  const breakLines = Object.entries(summary.breaks)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `• ${type}: ${count}`);
  const text = [
    `Tieout recon run \`${summary.runId}\` (as of ${summary.asOf})`,
    `${summary.matches} matches, ${summary.totalBreaks} breaks`,
    ...breakLines,
  ].join("\n");
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      console.error(`slack webhook responded ${response.status} — summary not delivered`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`slack webhook unreachable — summary not delivered: ${String(err)}`);
    return false;
  }
}
