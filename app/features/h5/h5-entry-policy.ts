import type { RuntimeActivity } from "../../api";

export function h5EntryPolicy(activity?: RuntimeActivity | null) {
  if (!activity) return { mode: "loading", channel: "" } as const;
  if (activity.whitelistCustomerTypeMode === "UNSPECIFIED") return { mode: "direct", channel: "", unspecified: true } as const;
  // Older API responses without this field retain the original two-channel flow.
  const types = activity.availableCustomerTypes;
  if (types?.length === 0) return { mode: "empty", channel: "" } as const;
  if (types?.length === 1) return { mode: "direct", channel: types[0] === "GENERAL" ? "综合客户" : "特渠专业客户" } as const;
  return { mode: "choose", channel: "" } as const;
}
