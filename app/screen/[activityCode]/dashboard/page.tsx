import { RoutedPrototype } from "../../../routed-prototype";

export default async function DashboardPage({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <RoutedPrototype activityCode={activityCode} surface="dashboard" />;
}
