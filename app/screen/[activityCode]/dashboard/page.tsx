import { ActivityRoute } from "../../../activity-routes";

export default async function DashboardPage({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <ActivityRoute activityCode={activityCode} surface="dashboard" />;
}
