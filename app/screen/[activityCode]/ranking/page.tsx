import { ActivityRoute } from "../../../activity-routes";

export default async function RankingPage({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <ActivityRoute activityCode={activityCode} surface="ranking" />;
}
