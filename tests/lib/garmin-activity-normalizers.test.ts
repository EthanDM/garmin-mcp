import { describe, expect, it } from "vitest";
import { normalizeActivity } from "../../src/lib/garmin-activity-normalizers.js";

const fixture = {
  activityId: "24634321892",
  activityName: "Synthetic run",
  activityType: "running",
  calories: 404,
  bmrCalories: 38,
  startTimeLocal: "2026-10-06T18:13:12.0",
  startTimeGMT: "2026-10-07T01:13:12.0",
  distance: 6489.08,
  duration: 1809.35,
  movingDuration: 1800,
  elapsedDuration: 1833
};

describe("activity semantics", () => {
  it("preserves the regression calorie numbers, time identity and distinct durations", () => {
    expect(normalizeActivity(fixture)).toMatchObject({
      activityId: "24634321892",
      totalCaloriesKcal: 404,
      restingCaloriesKcal: 38,
      activeCaloriesKcal: 366,
      activeCaloriesSource: "total_minus_resting",
      calorieStatus: "derived",
      startTimeLocal: fixture.startTimeLocal,
      startTimeUtc: "2026-10-07T01:13:12.000Z",
      timezone: null,
      device: null,
      distanceMeters: 6489.08,
      workoutDurationSeconds: 1809.35,
      movingDurationSeconds: 1800,
      elapsedDurationSeconds: 1833
    });
  });
  it.each([
    [404, undefined, null, "unavailable"],
    [undefined, 38, null, "unavailable"],
    [0, 0, 0, "derived"],
    [38, 38, 0, "derived"],
    [404, -1, null, "inconsistent"],
    [-1, 0, null, "inconsistent"],
    [404, 405, null, "inconsistent"],
    [NaN, 38, null, "inconsistent"],
    [404, Infinity, null, "inconsistent"],
    ["404", 38, null, "inconsistent"]
  ])(
    "handles %s minus %s without substitution",
    (total, resting, active, status) => {
      const result = normalizeActivity({
        ...fixture,
        calories: total,
        bmrCalories: resting
      });
      expect(result.activeCaloriesKcal).toBe(active);
      expect(result.calorieStatus).toBe(status);
    }
  );
  it("does not infer UTC from local time or accept invalid timestamps", () => {
    expect(
      normalizeActivity({ ...fixture, startTimeGMT: undefined }).startTimeUtc
    ).toBeNull();
    expect(
      normalizeActivity({ ...fixture, startTimeLocal: "2026-02-30T18:13:12" })
        .startTimeLocal
    ).toBeNull();
    expect(
      normalizeActivity({
        ...fixture,
        startTimeGMT: "2026-10-06T18:13:12-07:00"
      }).startTimeUtc
    ).toBe("2026-10-07T01:13:12.000Z");
  });
  it("requires opaque decimal string IDs and excludes unexpected fields", () => {
    expect(() =>
      normalizeActivity({ ...fixture, activityId: 24634321892 })
    ).toThrow();
    const result = normalizeActivity({
      ...fixture,
      startLatitude: 1,
      accessToken: "secret",
      activityName: "a\ncommand"
    });
    expect(result.name).toBe("a command");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result).not.toHaveProperty("startLatitude");
  });
});
