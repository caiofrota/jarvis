import { Suspense } from "react";
import { Dashboard } from "../src/features/dashboard/Dashboard";

export default function Page() {
  return (
    <Suspense fallback={<p>Carregando painel…</p>}>
      <Dashboard section="overview" />
    </Suspense>
  );
}
