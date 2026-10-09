import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  executeComputerRequest,
  readComputerCatalog,
} from "../src/features/studio/computer-client";

function fixture() {
  const clientId = randomUUID(),
    id = "boreal",
    label = "Boreal Explorer";
  const api = {
    actions: vi.fn(async () => ({
      clientId,
      items: [{ id, label, kind: "app", available: true, target: "private-path" }],
      apps: [],
    })),
    prepareAction: vi.fn(async () => ({ id, label, token: "token" })),
    executeAction: vi.fn(async () => ({ status: "sent" })),
    cancelAction: vi.fn(async () => {}),
  };
  const events = new EventTarget();
  Object.assign(events, { jarvisCompanionWindows: api });
  vi.stubGlobal("window", events);
  return {
    api,
    events,
    offer: {
      requestId: randomUUID(),
      clientId,
      id,
      label,
      newInstance: false,
      expires: Date.now() + 120000,
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("sends only catalog metadata and reports a local receipt after execution", async () => {
  const f = fixture(),
    changed = vi.fn();
  f.events.addEventListener("jarvis-computer-actions-changed", changed);
  expect((await readComputerCatalog())?.targets).toEqual([
    { id: f.offer.id, label: f.offer.label, kind: "app" },
  ]);
  expect(await executeComputerRequest(f.offer, () => true)).toBe("sent");
  expect(f.api.executeAction).toHaveBeenCalledExactlyOnceWith("token");
  expect(changed).toHaveBeenCalledOnce();
});
it("reports native cancellation without retry and releases panel busy state", async () => {
  const f = fixture(),
    busy: boolean[] = [];
  f.events.addEventListener("jarvis-computer-busy", (event) =>
    busy.push((event as CustomEvent<boolean>).detail),
  );
  f.api.executeAction.mockRejectedValueOnce(
    Object.assign(new Error("cancelled"), { code: "ACTION_CANCELLED" }),
  );
  expect(await executeComputerRequest(f.offer, () => true)).toBe("cancelled");
  expect(f.api.executeAction).toHaveBeenCalledOnce();
  expect(busy).toEqual([true, false]);
});
it("rejects a different native process, expired offers and interrupted preparation", async () => {
  const f = fixture();
  expect(await executeComputerRequest({ ...f.offer, clientId: randomUUID() }, () => true)).toBe(
    "failed",
  );
  expect(await executeComputerRequest({ ...f.offer, expires: Date.now() - 1 }, () => true)).toBe(
    "failed",
  );
  expect(f.api.prepareAction).not.toHaveBeenCalled();
  let current = true;
  f.api.prepareAction.mockImplementationOnce(async () => {
    current = false;
    return { id: f.offer.id, label: f.offer.label, token: "token" };
  });
  expect(await executeComputerRequest(f.offer, () => current)).toBe("cancelled");
  expect(f.api.cancelAction).toHaveBeenCalledOnce();
  expect(f.api.executeAction).not.toHaveBeenCalled();
});
