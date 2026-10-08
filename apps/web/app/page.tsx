import { Suspense } from "react";
import { LoadingScreen } from "../src/components/loading-screen/LoadingScreen";
import { Dashboard } from "../src/features/dashboard/Dashboard";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Dashboard />
    </Suspense>
  );
}
