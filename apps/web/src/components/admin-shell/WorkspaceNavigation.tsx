"use client";
import Link from "next/link";

const groups = [
  {
    label: "Assistentes",
    sections: ["personal", "assistants", "assistant-default"],
    items: [
      { id: "personal", label: "Seus assistentes", permission: "profile.manage" },
      { id: "assistants", label: "Compartilhados", permission: "catalog.read" },
      { id: "assistant-default", label: "Padrão da instalação", permission: "settings.manage" },
    ],
  },
  {
    label: "Casa",
    sections: [
      "overview",
      "homes",
      "rooms",
      "devices",
      "residents",
      "routines",
      "modes",
      "intents",
    ],
    items: [
      { id: "overview", label: "Resumo", permission: "status.read" },
      { id: "devices", label: "Dispositivos", permission: "catalog.read" },
      { id: "rooms", label: "Ambientes", permission: "catalog.read" },
      { id: "routines", label: "Automação", permission: "catalog.read" },
    ],
    advanced: [
      { id: "homes", label: "Casas" },
      { id: "residents", label: "Moradores" },
      { id: "modes", label: "Modos" },
      { id: "intents", label: "Respostas e humor" },
    ],
  },
  {
    label: "Configurações",
    sections: ["integrations", "account", "settings", "users", "provider-apps"],
    items: [
      { id: "integrations", label: "Minhas contas", permission: "profile.manage" },
      { id: "account", label: "Minha conta", permission: "profile.manage" },
      { id: "settings", label: "Sistema", permission: "settings.manage" },
      { id: "users", label: "Usuários", permission: "users.manage" },
      {
        id: "provider-apps",
        label: "Aplicativos Google e Microsoft",
        permission: "settings.manage",
      },
    ],
  },
];
export function WorkspaceNavigation({
  section,
  capabilities,
}: {
  section: string;
  capabilities: string[];
}) {
  const group = groups.find((value) => value.sections.includes(section));
  if (!group) return null;
  return (
    <div className="workspace-navigation">
      <nav className="workspace-links" aria-label={group.label}>
        {group.items
          .filter((item) => capabilities.includes(item.permission))
          .map((item) => (
            <Link
              key={item.id}
              href={item.id === "overview" ? "/overview" : `/${item.id}`}
              aria-current={section === item.id ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
      </nav>
      {group.advanced && capabilities.includes("catalog.read") && (
        <details
          className="workspace-advanced"
          open={group.advanced.some((item) => item.id === section)}
        >
          <summary>Ajustes da casa</summary>
          <nav aria-label="Ajustes da casa">
            {group.advanced.map((item) => (
              <Link
                key={item.id}
                href={`/${item.id}`}
                aria-current={section === item.id ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </details>
      )}
    </div>
  );
}
