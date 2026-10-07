import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Dashboard } from "../../src/features/dashboard/Dashboard";
import { labels } from "../../src/i18n/pt-BR";

// Keep panel routes to one segment so Next never claims /ws/robot/:id upgrades.
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (
    !["overview", "studio", "settings", "users", "account", ...Object.keys(labels)].includes(
      section,
    )
  )
    notFound();
  return (
    <Suspense fallback={<p>Carregando painel…</p>}>
      <Dashboard section={section} />
    </Suspense>
  );
}
