import { RoutedPrototype } from "../../routed-prototype";

export default async function H5Page({ params }: { params: Promise<{ activityCode: string }> }) {
  const { activityCode } = await params;
  return <RoutedPrototype activityCode={activityCode} surface="h5" />;
}
