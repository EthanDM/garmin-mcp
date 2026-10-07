import assert from "node:assert/strict";
import { getGarminConfig } from "./config.js";
import { formatErrorMessage } from "./errors.js";
import {
  BridgeProcessRunner,
  GarminBridgeClient
} from "./lib/garmin-bridge-client.js";
import { GarminClient } from "./lib/garmin.js";
/** Operator-only live read; never part of offline check and never logs activity names. */
async function main() {
  const runner = new BridgeProcessRunner(getGarminConfig());
  try {
    const client = new GarminClient(new GarminBridgeClient(runner.run));
    await client.listActivities({
      limit: 1,
      offset: 0,
      startDate: "2026-10-06",
      endDate: "2026-10-06"
    });
    const { activity } = await client.getActivity("24634321892");
    assert.equal(activity.totalCaloriesKcal, 404);
    assert.equal(activity.restingCaloriesKcal, 38);
    assert.equal(activity.activeCaloriesKcal, 366);
    assert.equal(
      activity.startTimeLocal?.replace(" ", "T").slice(0, 19),
      "2026-10-06T18:13:12"
    );
    assert.equal(activity.distanceMeters, 6489.08);
    assert.equal(activity.workoutDurationSeconds, 1809.35);
    console.log("Live bounded listing and regression activity verified.");
  } finally {
    runner.close();
  }
}
main().catch((error: unknown) => {
  console.error(formatErrorMessage(error));
  process.exitCode = 1;
});
