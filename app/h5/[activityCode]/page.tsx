import { ActivityRoute } from "../../activity-routes";

export default async function H5Page({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <ActivityRoute activityCode={activityCode} surface="h5" />;
}
