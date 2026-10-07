import { z } from "zod";
import { GarminMcpError } from "../errors.js";
import {
  normalizeActivity,
  projectedActivitySchema
} from "./garmin-activity-normalizers.js";
import type { GarminBridgeClient } from "./garmin-bridge-client.js";
import type { ListInput } from "../tools.js";

/** Garmin domain boundary: only bounded listing and one-activity detail. */
export class GarminClient {
  constructor(private readonly bridge: GarminBridgeClient) {}
  /** Returns only the requested page; a full page suggests another offset but proves no total. */
  async listActivities(input: ListInput) {
    const raw = z
      .array(projectedActivitySchema)
      .max(input.limit)
      .safeParse(await this.bridge.request("list", input));
    if (!raw.success) throw new GarminMcpError("bridge_protocol");
    const activities = raw.data.map(normalizeActivity);
    return {
      activities,
      offset: input.offset,
      limit: input.limit,
      returnedCount: activities.length,
      nextOffset:
        activities.length === input.limit && input.offset + input.limit <= 10000
          ? input.offset + input.limit
          : null,
      scope: "retrieved_page_only" as const,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null
    };
  }
  /** Fetches a single identity and rejects a provider response for a different activity. */
  async getActivity(activityId: string) {
    const raw = projectedActivitySchema.safeParse(
      await this.bridge.request("get", { activityId })
    );
    if (!raw.success) throw new GarminMcpError("bridge_protocol");
    const activity = normalizeActivity(raw.data);
    if (activity.activityId !== activityId)
      throw new GarminMcpError("bridge_protocol");
    return { activity };
  }
}
