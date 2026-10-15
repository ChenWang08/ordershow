"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, createActivity, getPreferredAdminActivityCode, setPreferredAdminActivityCode, loadAdminActivities, loadAdminDepartments, type RuntimeActivity, type AdminDepartment } from "../../api";
import { useAdminIdentity } from "../../admin-context";
import { nextMinuteDateTimeLocal, runtimeActivityStatus, toDateTimeLocal } from "../shared/utils";

type AdminActivitiesOptions = {
  activityId: string;
  activityCode: string;
  setActionNotice: (notice: string) => void;
};

export function useAdminActivities({ activityId, activityCode, setActionNotice }: AdminActivitiesOptions) {
  const adminIdentity = useAdminIdentity();
  const [activities, setActivities] = useState<RuntimeActivity[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [activityDepartmentFilter, setActivityDepartmentFilter] = useState("");
  const [activityMenuOpen, setActivityMenuOpen] = useState(false);
  const [newActivityOpen, setNewActivityOpen] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [newActivity, setNewActivity] = useState<{ name: string; startsAt: string; endsAt: string; eventEndsAt: string; departmentId: string }>(
    { name: "", startsAt: nextMinuteDateTimeLocal(), endsAt: "", eventEndsAt: "", departmentId: "" },
  );
  const [minimumFutureAt, setMinimumFutureAt] = useState(nextMinuteDateTimeLocal);
  const currentActivity = activities.find((item) => item.code === activityCode);
  const visibleActivities = useMemo(
    () => activityDepartmentFilter ? activities.filter((item) => String(item.departmentId) === activityDepartmentFilter) : activities,
    [activities, activityDepartmentFilter],
  );
  useEffect(() => {
    let active = true;
    void loadAdminActivities().then((items) => {
      if (!active) return;
      setActivities(items);
      const savedCode = getPreferredAdminActivityCode();
      const savedActivity = savedCode ? items.find((item) => item.code === savedCode) : undefined;
      if (!savedActivity && items.length > 0) {
        const preferred = items.find((item) => runtimeActivityStatus(item.status) === "running")
          ?? items.find((item) => runtimeActivityStatus(item.status) === "scheduled")
          ?? items[0];
        setPreferredAdminActivityCode(preferred.code);
        if (preferred.code !== activityCode) window.location.replace("/admin");
      } else if (savedActivity && savedActivity.code !== activityCode) {
        window.location.replace("/admin");
      }
    }).catch(() => { if (active) setActivities([]); });
    return () => { active = false; };
  }, [activityCode, activityId]);
  useEffect(() => {
    if (adminIdentity?.roleCode !== "SUPER_ADMIN") {
      return;
    }
    let active = true;
    void loadAdminDepartments().then((items) => { if (active) setDepartments(items); }).catch(() => { if (active) setDepartments([]); });
    return () => { active = false; };
  }, [adminIdentity?.roleCode]);
  useEffect(() => {
    const refreshMinimum = () => setMinimumFutureAt(nextMinuteDateTimeLocal());
    const timer = window.setInterval(refreshMinimum, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const openNewActivity = () => {
    if (adminIdentity?.roleCode === "DEPARTMENT_MEMBER") return;
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    startsAt.setSeconds(0, 0);
    const endsAt = new Date(startsAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    const eventEndsAt = new Date(endsAt.getTime() + 4 * 60 * 60 * 1000);
    const currentDepartmentId = activities.find((item) => item.code === activityCode)?.departmentId
      ?? departments.find((item) => item.code === "DEFAULT")?.id;
    setNewActivity({ name: "", startsAt: toDateTimeLocal(startsAt.toISOString()), endsAt: toDateTimeLocal(endsAt.toISOString()), eventEndsAt: toDateTimeLocal(eventEndsAt.toISOString()), departmentId: currentDepartmentId == null ? "" : String(currentDepartmentId) });
    setActivityMenuOpen(false);
    setNewActivityOpen(true);
  };

  const submitNewActivity = async () => {
    if (adminIdentity?.roleCode === "DEPARTMENT_MEMBER") return;
    if (!newActivity.name.trim() || !newActivity.startsAt || !newActivity.endsAt || !newActivity.eventEndsAt) {
      setActionNotice("请完整填写活动名称、订货时间和整场活动结束时间。");
      return;
    }
    if (adminIdentity?.roleCode === "SUPER_ADMIN" && !newActivity.departmentId) {
      setActionNotice("超级管理员创建活动时必须选择所属部门。");
      return;
    }
    if (new Date(newActivity.startsAt) >= new Date(newActivity.endsAt)) {
      setActionNotice("订货截止时间必须晚于开始时间。");
      return;
    }
    if (new Date(newActivity.eventEndsAt) <= new Date(newActivity.endsAt)) {
      setActionNotice("整场活动结束时间必须晚于订货截止时间。");
      return;
    }
    setCreatingActivity(true);
    try {
      const created = await createActivity({
        name: newActivity.name,
        startsAt: newActivity.startsAt,
        endsAt: newActivity.endsAt,
        eventEndsAt: newActivity.eventEndsAt,
        ...(adminIdentity?.roleCode === "SUPER_ADMIN" ? { departmentId: Number(newActivity.departmentId) } : {}),
      });
      setPreferredAdminActivityCode(created.code);
      window.location.assign("/admin");
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "新建活动失败，请稍后重试。");
      setCreatingActivity(false);
    }
  };
  return {
    currentActivity,
    visibleActivities,
    departments,
    activityDepartmentFilter,
    setActivityDepartmentFilter,
    activityMenuOpen,
    setActivityMenuOpen,
    newActivityOpen,
    setNewActivityOpen,
    creatingActivity,
    newActivity,
    setNewActivity,
    minimumFutureAt,
    openNewActivity,
    submitNewActivity,
  };
}
