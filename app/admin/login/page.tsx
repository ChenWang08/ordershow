import { ACTIVITY_CODE } from "../../api";
import { ActivityRoute } from "../../activity-routes";

export default function AdminLoginPage() {
  return <ActivityRoute activityCode={ACTIVITY_CODE} surface="admin" />;
}
