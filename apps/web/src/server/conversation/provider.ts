import type { Settings } from "@rosie/types";
import { DomainError } from "@rosie/types/context";

export type CompletionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
};
export async function completion(
  settings: Pick<Settings, "openaiKey" | "deepseekKey">,
  provider: "openai" | "deepseek",
  payload: unknown,
  signal: AbortSignal,
) {
  const key = provider === "openai" ? settings.openaiKey : settings.deepseekKey;
  if (!key) throw new DomainError("Configure o provedor de conversa nas configurações do Jarvis.");
  const response = await fetch(
    provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    },
  );
  if (!response.ok)
    throw new DomainError(`O provedor de conversa não respondeu (${response.status}).`);
  return (await response.json()) as {
    choices: { finish_reason?: string; message: CompletionMessage }[];
    usage: Record<string, unknown>;
  };
}
