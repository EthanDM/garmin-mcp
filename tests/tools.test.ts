import { describe, expect, it, vi } from "vitest";
import {
  createTools,
  listActivitiesSchema,
  getActivitySchema
} from "../src/tools.js";
import { GarminClient } from "../src/lib/garmin.js";
import { GarminBridgeClient } from "../src/lib/garmin-bridge-client.js";
import { pageSchema, activitySchema } from "../src/types.js";
import { formatErrorMessage } from "../src/errors.js";

const activity = { activityId: "24634321892", calories: 404, bmrCalories: 38 };
describe("tools and domain contract", () => {
  it("uses bounded defaults and date refinements", () => {
    expect(listActivitiesSchema.parse({})).toEqual({ limit: 10, offset: 0 });
    for (const input of [
      { limit: 51 },
      { limit: 0 },
      { offset: -1 },
      { offset: 10001 },
      { startDate: "2026-10-06" },
      { startDate: "2026-02-30", endDate: "2026-03-01" },
      { startDate: "2026-10-07", endDate: "2026-10-06" },
      { startDate: "2020-01-01", endDate: "2026-01-01" },
      { endpoint: "secret" }
    ])
      expect(listActivitiesSchema.safeParse(input).success).toBe(false);
    expect(
      listActivitiesSchema.safeParse({
        startDate: "2026-10-06",
        endDate: "2026-10-06"
      }).success
    ).toBe(true);
    for (const id of ["0", "1/../", "1e4", 1, "garmin_ping_639161568056"])
      expect(getActivitySchema.safeParse({ activityId: id }).success).toBe(
        false
      );
  });
  it("returns schema-valid structured content plus matching JSON, preserving ordering", async () => {
    const runner = vi.fn(async (request) =>
      JSON.stringify({
        ok: true,
        data:
          request.operation === "list"
            ? [activity, { ...activity, activityId: "2" }]
            : activity
      })
    );
    const tools = createTools(new GarminClient(new GarminBridgeClient(runner)));
    expect(tools.map((t) => t.name)).toEqual([
      "garmin_list_activities",
      "garmin_get_activity"
    ]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    const page = await tools[0].handler({ limit: 2 });
    expect(page).not.toHaveProperty("isError");
    if (!("structuredContent" in page)) throw new Error("missing output");
    const parsed = pageSchema.parse(page.structuredContent);
    expect(parsed.activities.map((a) => a.activityId)).toEqual([
      "24634321892",
      "2"
    ]);
    expect(parsed.nextOffset).toBe(2);
    expect(JSON.parse(page.content[0].text)).toEqual(page.structuredContent);
    const detail = await tools[1].handler({ activityId: "24634321892" });
    if (!("structuredContent" in detail) || !detail.structuredContent)
      throw new Error("missing output");
    expect(
      activitySchema.parse(detail.structuredContent.activity).activeCaloriesKcal
    ).toBe(366);
  });
  it("validates before calling transport and redacts arbitrary errors", async () => {
    const listActivities = vi.fn(async () => {
      throw new Error("token=SECRET");
    });
    const tools = createTools({ listActivities, getActivity: vi.fn() });
    expect(await tools[0].handler({ startDate: "2026-10-06" })).toMatchObject({
      isError: true
    });
    expect(listActivities).not.toHaveBeenCalled();
    expect(JSON.stringify(await tools[0].handler({}))).not.toContain("SECRET");
    expect(formatErrorMessage(new Error("Authorization SECRET"))).not.toContain(
      "SECRET"
    );
  });
  it("rejects unexpected raw envelopes instead of accepting private fields", async () => {
    const client = new GarminClient(
      new GarminBridgeClient(async () =>
        JSON.stringify({ ok: true, data: { ...activity, owner: "SECRET" } })
      )
    );
    await expect(client.getActivity("24634321892")).rejects.toMatchObject({
      code: "bridge_protocol"
    });
  });
  it("rejects excessive pages and mismatched IDs", async () => {
    const oversized = new GarminClient(
      new GarminBridgeClient(async () =>
        JSON.stringify({ ok: true, data: [activity, activity] })
      )
    );
    await expect(
      oversized.listActivities({ limit: 1, offset: 0 })
    ).rejects.toMatchObject({ code: "bridge_protocol" });
    const wrongId = new GarminClient(
      new GarminBridgeClient(async () =>
        JSON.stringify({ ok: true, data: activity })
      )
    );
    await expect(wrongId.getActivity("2")).rejects.toMatchObject({
      code: "bridge_protocol"
    });
  });
});
