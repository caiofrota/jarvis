import { faHouse, faMicrophoneLines, faRobot, faSliders } from "@fortawesome/free-solid-svg-icons";
export const navigation = [
  {
    id: "studio",
    label: "Conversa",
    icon: faRobot,
    permission: "companion.use",
    sections: ["studio"],
  },
  {
    id: "personal",
    label: "Assistentes",
    icon: faRobot,
    permission: "profile.manage",
    sections: ["personal", "assistants", "assistant-default"],
  },
  {
    id: "overview",
    label: "Casa",
    icon: faHouse,
    permission: "catalog.read",
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
  },
  {
    id: "endpoints",
    label: "Caixinhas",
    icon: faMicrophoneLines,
    permission: "catalog.read",
    sections: ["endpoints"],
  },
  {
    id: "integrations",
    label: "Configurações",
    icon: faSliders,
    permission: "profile.manage",
    sections: ["integrations", "account", "settings", "users", "provider-apps"],
  },
];
