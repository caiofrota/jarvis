import type { Settings } from "@rosie/types";

export interface Addon {
  readonly id: string;
  readonly capabilities: readonly ("readings" | "commands" | "web-search" | "calendar")[];
  configure(settings: Settings): Promise<void>;
  close(): void;
}
