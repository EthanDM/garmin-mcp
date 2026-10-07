import { z } from "zod";
import { GarminMcpError } from "../errors.js";
import type { Activity } from "../types.js";

/** The bridge projection is closed: unexpected raw/provider envelopes are rejected. */
export const projectedActivitySchema = z
  .object({
    activityId: z.string().regex(/^[1-9][0-9]{0,29}$/),
    activityName: z.unknown().optional(),
    activityType: z.unknown().optional(),
    startTimeLocal: z.unknown().optional(),
    startTimeGMT: z.unknown().optional(),
    distance: z.unknown().optional(),
    duration: z.unknown().optional(),
    movingDuration: z.unknown().optional(),
    elapsedDuration: z.unknown().optional(),
    calories: z.unknown().optional(),
    bmrCalories: z.unknown().optional(),
    averageHR: z.unknown().optional(),
    maxHR: z.unknown().optional(),
    elevationGain: z.unknown().optional(),
    elevationLoss: z.unknown().optional()
  })
  .strict();

/** Accepts only projected bridge records, never a full Garmin envelope. */
export function normalizeActivity(raw: Record<string, unknown>): Activity {
  const id = raw.activityId;
  if (typeof id !== "string" || !/^[1-9][0-9]{0,29}$/.test(id))
    throw new GarminMcpError("bridge_protocol");
  const total = metric(raw.calories),
    resting = metric(raw.bmrCalories);
  const inconsistent =
    (raw.calories != null && total === null) ||
    (raw.bmrCalories != null && resting === null) ||
    (total !== null && resting !== null && resting > total);
  const active =
    !inconsistent && total !== null && resting !== null
      ? total - resting
      : null;
  return {
    activityId: id,
    name: text(raw.activityName, 500),
    sport: text(raw.activityType, 100),
    startTimeLocal: timestamp(raw.startTimeLocal, false),
    startTimeUtc: timestamp(raw.startTimeGMT, true),
    // Provider timezone/device structures vary; keep unknown rather than inferring Phoenix or a device model.
    timezone: null,
    device: null,
    distanceMeters: metric(raw.distance),
    workoutDurationSeconds: metric(raw.duration),
    movingDurationSeconds: metric(raw.movingDuration),
    elapsedDurationSeconds: metric(raw.elapsedDuration),
    totalCaloriesKcal: total,
    restingCaloriesKcal: resting,
    activeCaloriesKcal: active,
    activeCaloriesSource: active === null ? null : "total_minus_resting",
    calorieStatus: inconsistent
      ? "inconsistent"
      : active === null
        ? "unavailable"
        : "derived",
    averageHeartRateBpm: metric(raw.averageHR),
    maximumHeartRateBpm: metric(raw.maxHR),
    elevationGainMeters: metric(raw.elevationGain),
    elevationLossMeters: metric(raw.elevationLoss)
  };
}
/** Missing/invalid numeric measurements remain unknown, preserving valid zero. */
function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
/** Bounds names and removes control characters; remaining provider text is still untrusted. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex -- Controls are explicitly removed from untrusted provider names.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
/** GMT fields establish UTC; local wall time is preserved without host-timezone parsing. */
function timestamp(value: unknown, utc: boolean): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value
    );
  if (!match) return null;
  const wall = `${match[1]}T${match[2]}${match[3] ?? ""}`;
  const check = new Date(`${wall}Z`);
  if (
    !Number.isFinite(check.getTime()) ||
    check.toISOString().slice(0, 19) !== wall.slice(0, 19)
  )
    return null;
  if (match[4] && !Number.isFinite(Date.parse(`${wall}${match[4]}`)))
    return null;
  if (!utc) return value;
  const result = new Date(`${wall}${match[4] ?? "Z"}`);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}
