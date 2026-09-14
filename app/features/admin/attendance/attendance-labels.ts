export const attendanceMatchLabels = { MATCHED: "已关联", PENDING_CONFIRMATION: "待确认", UNMATCHED: "未关联" } as const;
export const attendanceMethodLabels = { PHONE: "手机号", FULL_NAME: "经销商全称", FULL_NAME_BRANCH: "分公司 + 经销商全称", SHORT_NAME: "分公司 + 经销商简称", MANUAL: "人工确认" } as const;
export const attendanceReasonLabels: Record<string, string> = {
  PHONE_NAME_CONFLICT: "历史手机号与名称冲突", FULL_SHORT_NAME_CONFLICT: "全称与简称冲突",
  MULTIPLE_CANDIDATES: "存在多个候选", CUSTOMER_TYPE_UNKNOWN: "客户类型无法识别",
  WHITELIST_NOT_PUBLISHED: "白名单未发布", NO_UNIQUE_MATCH: "没有唯一匹配结果", LEGACY_UNMATCHED: "历史记录未关联",
};
