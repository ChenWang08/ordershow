import type { AdminIdentity } from "../../api";

export const memberModules = [
  { code: "OVERVIEW", label: "活动概览", tab: "活动概览" },
  { code: "PRODUCT", label: "商品管理", tab: "商品导入" },
  { code: "WHITELIST", label: "白名单管理", tab: "白名单" },
  { code: "ATTENDANCE", label: "现场到场", tab: "现场到场" },
  { code: "ORDER", label: "订单管理", tab: "订单管理" },
  { code: "LOTTERY", label: "抽奖管理", tab: "抽奖规则" },
] as const;
export type MemberPermission = typeof memberModules[number]["code"];
export function isManager(identity: AdminIdentity | null) {
  return identity?.roleCode === "SUPER_ADMIN" || identity?.roleCode === "DEPARTMENT_ADMIN";
}
export function canUse(identity: AdminIdentity | null, permission: MemberPermission) {
  return isManager(identity) || Boolean(identity?.permissions?.includes(permission));
}
export function adminNavigation(identity: AdminIdentity | null): string[] {
  return [...memberModules.filter(module => canUse(identity, module.code)).map(module => module.tab),
    ...(isManager(identity) ? ["成员管理"] : []), ...(identity?.roleCode === "SUPER_ADMIN" ? ["部门与账号"] : [])];
}
export function roleLabel(identity: AdminIdentity | null) {
  return identity?.roleCode === "SUPER_ADMIN" ? "超级管理员" : identity?.roleCode === "DEPARTMENT_MEMBER" ? "部门成员" : "部门管理员";
}
