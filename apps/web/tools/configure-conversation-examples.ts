import { loadConfig } from "../src/server/config";
import { conversationExamples } from "../src/server/conversation/examples";

const config = loadConfig();
const endpointId = process.env.ROSIE_EXAMPLE_ENDPOINT;
if (!endpointId) throw new Error("Set ROSIE_EXAMPLE_ENDPOINT to the intended endpoint");
let cookie = "";
type Row = Record<string, unknown> & {
  id: string;
  name: string;
  homeId: string;
  assistantId: string;
  revision: number;
};
async function call(path: string, method = "GET", data?: unknown) {
  const response = await fetch(`http://127.0.0.1:${config.port}/api/v1${path}`, {
    method,
    headers: { cookie, origin: config.origin, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Configuration failed: ${path} HTTP ${response.status}`);
  if (path === "/login") cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return response.json();
}
async function rows(kind: string): Promise<Row[]> {
  const result: Row[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await call(`/catalog/${kind}?pageSize=100&page=${page}`);
    result.push(...data.items);
    if (result.length >= data.total) break;
  }
  return result;
}
try {
  await call("/login", "POST", { password: config.adminToken });
  const endpoint = (await rows("endpoints")).find((v) => v.id === endpointId);
  if (!endpoint) throw new Error("Endpoint not found");
  const existing = await rows("intents");
  for (const intent of conversationExamples(endpoint.homeId, endpoint.assistantId)) {
    const old = existing.find((v) => v.homeId === intent.homeId && v.name === intent.name);
    if (old) {
      console.log(`Preserved existing intent: ${old.name}`);
      continue;
    }
    const saved = await call("/catalog/intents", "POST", intent);
    console.log(`Installed intent: ${saved.name}`);
  }
  const home = (await rows("homes")).find((v) => v.id === endpoint.homeId);
  if (home && !/cachorr|cadela/i.test(String(home.facts ?? ""))) {
    await call(`/catalog/homes/${home.id}`, "PUT", {
      ...home,
      facts: `${String(home.facts ?? "").trim()}\nA família tem cachorras.`.trim(),
    });
    console.log("Added the user-confirmed household pet fact; existing facts preserved.");
  }
} finally {
  if (cookie) await call("/logout", "POST").catch(() => {});
}
