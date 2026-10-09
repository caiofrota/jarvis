import type { Options } from "../../../lib/api-client";
export type FormProps = {
  value: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  options: Options;
  voices: string[];
  cloudHomeId?: string;
  voiceNames?: Record<string, string>;
};
export function homeOptions(options: Options, kind: string, homeId: unknown) {
  return (options[kind] ?? []).filter((v) => !v.homeId || v.homeId === homeId);
}
