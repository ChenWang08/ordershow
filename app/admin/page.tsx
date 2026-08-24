import { ACTIVITY_CODE } from "../api";
import { RoutedPrototype } from "../routed-prototype";

export default function AdminPage() {
  return <RoutedPrototype activityCode={ACTIVITY_CODE} surface="admin" />;
}
