import { RoutedPrototype } from "../../../routed-prototype";

export default async function RankingPage({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <RoutedPrototype activityCode={activityCode} surface="ranking" />;
}
