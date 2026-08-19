import { writeRunLog } from "../runlog.js";

/** Hourly heartbeat — guarantees Run Log rows spread across the event days. */
export async function healthCheck(): Promise<void> {
  await writeRunLog({
    trigger: "health",
    job: "healthCheck",
    outcome: "success",
    meta: "heartbeat · service is up",
  });
}