import type { Dispatch, SetStateAction } from "react";
import type { ProductImportRow } from "../../domain/import-domain";
import type { ActivityStatus } from "../shared/types";

export type ImportTaskIds = Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>;

export type ProductModuleOptions = {
  importWaitOptions?: () => import("../../api").ImportWaitOptions;
  activityId: string;
  activityStatus: ActivityStatus;
  productRows: ProductImportRow[];
  setProductRows: Dispatch<SetStateAction<ProductImportRow[]>>;
  productImportCompleted: boolean;
  serverImportTasks: ImportTaskIds;
  setActionNotice: (notice: string) => void;
  recordOperation: (action: string, target: string, detail: string) => void;
};
