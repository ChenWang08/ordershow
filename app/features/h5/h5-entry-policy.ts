import type { RuntimeActivity } from "../../api";

export function h5EntryPolicy(activity?: RuntimeActivity | null) {
  if (!activity) return { mode: "loading", channel: "" } as const;
  if (activity.whitelistCustomerTypeMode === "UNSPECIFIED") return { mode: "direct", channel: "", unspecified: true } as const;
  const types = activity.availableCustomerTypes;
  if (types?.length === 0) return { mode: "empty", channel: "" } as const;
  // Phone lookup, not activity-wide metadata, determines whether a choice is needed.
  return { mode: "direct", channel: "" } as const;
}
