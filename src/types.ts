import { z } from "zod";
const metric = z.number().finite().nonnegative().nullable();
/** Null means provider data is missing, invalid, or has unverified semantics. */
export const activitySchema = z.object({
  activityId: z.string().regex(/^[1-9][0-9]{0,29}$/),
  name: z.string().max(500).nullable(),
  sport: z.string().max(100).nullable(),
  startTimeLocal: z.string().nullable(),
  startTimeUtc: z.string().nullable(),
  timezone: z.string().nullable(),
  device: z.string().nullable(),
  distanceMeters: metric,
  workoutDurationSeconds: metric,
  movingDurationSeconds: metric,
  elapsedDurationSeconds: metric,
  totalCaloriesKcal: metric,
  restingCaloriesKcal: metric,
  activeCaloriesKcal: metric,
  activeCaloriesSource: z.literal("total_minus_resting").nullable(),
  calorieStatus: z.enum(["derived", "unavailable", "inconsistent"]),
  averageHeartRateBpm: metric,
  maximumHeartRateBpm: metric,
  elevationGainMeters: metric,
  elevationLossMeters: metric
});
export type Activity = z.infer<typeof activitySchema>;
export const pageSchema = z.object({
  activities: z.array(activitySchema).max(50),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(50),
  returnedCount: z.number().int().nonnegative(),
  nextOffset: z.number().int().nullable(),
  scope: z.literal("retrieved_page_only"),
  startDate: z.string().nullable(),
  endDate: z.string().nullable()
});
export type ActivityPage = z.infer<typeof pageSchema>;
