import type { Dispatch, SetStateAction } from "react";
import type { ActivityStatus } from "../shared/types";
import type { ImportTaskIds } from "./product-module-types";

export type CustomerModuleOptions = {
  activityId: string;
  activityStatus: ActivityStatus;
  serverImportTasks: ImportTaskIds;
  setActionNotice: (notice: string) => void;
  recordOperation: (action: string, target: string, detail: string) => void;
  refreshServerImportPreview: (type: "PRODUCT" | "WHITELIST" | "ATTENDANCE") => Promise<void>;
};

export type CustomerImportOptions = CustomerModuleOptions & {
  importWaitOptions?: () => import("../../api").ImportWaitOptions;
  serverImportBlocking: ImportTaskIds;
  setServerImportTasks: Dispatch<SetStateAction<ImportTaskIds>>;
  setServerImportBlocking: Dispatch<SetStateAction<ImportTaskIds>>;
};
