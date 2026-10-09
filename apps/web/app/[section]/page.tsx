import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingScreen } from "../../src/components/loading-screen/LoadingScreen";
import { Dashboard } from "../../src/features/dashboard/Dashboard";
import { labels } from "../../src/i18n/pt-BR";

// Keep panel routes to one segment so Next never claims /ws/robot/:id upgrades.
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (
    ![
      "overview",
      "studio",
      "personal",
      "integrations",
      "assistant-default",
      "provider-apps",
      "settings",
      "users",
      "account",
      ...Object.keys(labels),
    ].includes(section)
  )
    notFound();
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Dashboard section={section} />
    </Suspense>
  );
}
