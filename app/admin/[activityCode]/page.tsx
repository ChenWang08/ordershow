import { LegacyAdminActivityRoute } from "../../activity-routes";

export default async function AdminActivityPage({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <LegacyAdminActivityRoute activityCode={activityCode} />;
}
