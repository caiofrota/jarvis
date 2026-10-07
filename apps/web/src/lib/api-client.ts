import type { HomeAssistantStatus, WebReferences, WebSearchStatus } from "@rosie/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    credentials: "same-origin",
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? "Não foi possível concluir.", response.status);
  return data as T;
}
export type Option = {
  id: string;
  name: string;
  homeId?: string;
  roomId?: string;
  actions?: string[];
  kind?: string;
};
export type Options = Record<string, Option[]>;
export type RecordRow = Record<string, unknown> & {
  id: string;
  name: string;
  revision: number;
  enabled: boolean;
};
export type PageResult = {
  items: RecordRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  direction: string;
};
export type Status = {
  robots: Record<string, string>;
  identifiedResidents?: Record<string, string | null>;
  mqtt: boolean;
  homeAssistant?: HomeAssistantStatus;
  webSearch: WebSearchStatus;
  voiceReferences: Record<string, WebReferences>;
  speech: {
    ready: boolean;
    voices: string[];
    busy: boolean;
    cloudHomeId?: string;
    cloudError?: string;
  };
  events: { id: number; time: string; kind: string; detail: Record<string, unknown> }[];
};
