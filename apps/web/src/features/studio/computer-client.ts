import {
  type CompanionComputerOffer,
  companionComputerOfferSchema,
  companionComputerSchema,
} from "@rosie/types";
export async function readComputerCatalog() {
  const api = window.jarvisCompanionWindows;
  if (!api) return undefined;
  const catalog = await api.actions();
  if (!catalog.clientId) return undefined;
  return companionComputerSchema.parse({
    clientId: catalog.clientId,
    targets: [...catalog.items, ...catalog.apps]
      .filter((target) => target.available)
      .slice(0, 600)
      .map(({ id, label, kind }) => ({ id, label, kind })),
  });
}
export async function executeComputerRequest(
  raw: CompanionComputerOffer,
  current: () => boolean,
): Promise<"sent" | "cancelled" | "failed"> {
  const offer = companionComputerOfferSchema.parse(raw),
    api = window.jarvisCompanionWindows;
  if (!api || !current()) return "cancelled";
  window.dispatchEvent(new CustomEvent("jarvis-computer-busy", { detail: true }));
  try {
    const catalog = await readComputerCatalog();
    if (!current()) return "cancelled";
    if (
      catalog?.clientId !== offer.clientId ||
      !catalog.targets.some((target) => target.id === offer.id && target.label === offer.label) ||
      Date.now() > offer.expires
    )
      return "failed";
    const prepared = await api.prepareAction(offer.id, offer.newInstance);
    if (
      !current() ||
      Date.now() > offer.expires ||
      prepared.id !== offer.id ||
      prepared.label !== offer.label
    ) {
      await api.cancelAction();
      return "cancelled";
    }
    await api.executeAction(prepared.token);
    return "sent";
  } catch (cause) {
    return cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ACTION_CANCELLED"
      ? "cancelled"
      : "failed";
  } finally {
    window.dispatchEvent(new CustomEvent("jarvis-computer-busy", { detail: false }));
    window.dispatchEvent(new Event("jarvis-computer-actions-changed"));
  }
}
