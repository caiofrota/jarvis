import { setTimeout as pause } from "node:timers/promises";
import { loadConfig } from "../src/server/config";

const config = loadConfig(),
  base = `http://127.0.0.1:${config.port}`,
  headers = { origin: config.origin, "content-type": "application/json" };
let cookie = "";
async function call(path: string, method = "GET", input?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { ...headers, cookie },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Health check failed at ${path}: HTTP ${response.status}`);
  if (path === "/login") cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return response.json();
}
try {
  const anonymous = await fetch(`${base}/api/v1/settings`, { signal: AbortSignal.timeout(5000) });
  if (anonymous.status !== 401) throw new Error("Administrative routes are not protected");
  await call("/login", "POST", { password: config.adminToken });
  const status = await call("/status");
  if (!status.speech.ready) throw new Error("Speech worker is unavailable");
  const endpoints = await call("/catalog/endpoints");
  if (endpoints.items.some((row: Record<string, unknown>) => "token" in row))
    throw new Error("Endpoint credential exposed in catalog");
  console.log(
    JSON.stringify({
      speechReady: status.speech.ready,
      voices: status.speech.voices,
      robots: status.robots,
      mqtt: status.mqtt,
    }),
  );
  if (process.argv.includes("--test-voice")) {
    const id = process.env.ROSIE_SMOKE_ENDPOINT;
    if (!id || !status.robots[id])
      throw new Error("Set ROSIE_SMOKE_ENDPOINT to a connected endpoint");
    const previous = status.events[0]?.id ?? 0;
    await call(`/endpoints/${id}/test-voice`, "POST");
    let complete = false;
    for (let i = 0; i < 90; i++) {
      await pause(1000);
      const next = await call("/status");
      const events = next.events.filter(
        (event: { id: number; detail: Record<string, unknown> }) =>
          event.id > previous && event.detail.endpoint === id,
      );
      if (events.some((event: { kind: string }) => event.kind === "voice_error"))
        throw new Error("Physical endpoint voice test reported a processing or playback error");
      const event = events.find((event: { kind: string }) => event.kind === "playback_complete");
      if (event) {
        console.log(JSON.stringify({ playbackAcknowledged: event.detail }));
        complete = true;
        break;
      }
    }
    if (!complete) throw new Error("Voice test did not complete before the deadline");
  }
} finally {
  if (cookie) await call("/logout", "POST").catch(() => {});
}
