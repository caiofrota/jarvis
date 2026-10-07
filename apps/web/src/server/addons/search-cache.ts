import { createHash } from "node:crypto";
import { normalize, type Reply, type WebSearchPeriod } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import type { SearchPresentation } from "../conversation/weather-request";
import type { FlightCriteria } from "../conversation/web-search";

export type SearchContext = {
  endpointId: string;
  homeId?: string;
  city: string;
  timezone: string;
  period?: WebSearchPeriod;
  fresh?: boolean;
  presentation?: SearchPresentation;
  flight?: FlightCriteria;
};
export const SEARCH_CACHE_MAX = 128;
export function cachePolicy(query: string): { kind: string; ttlMs: number } {
  const q = normalize(query);
  if (/\b(ao vivo|placar|cotacao|agora|tempo real)\b/.test(q))
    return { kind: "live", ttlMs: 30_000 };
  if (/\b(passagem|passagens|voo|voos|aereo|aerea|aereas)\b/.test(q))
    return { kind: "flights", ttlMs: 120_000 };
  if (/\b(clima|temperatura|previsao do tempo|chuva|weather)\b/.test(q))
    return { kind: "weather", ttlMs: 300_000 };
  if (/\b(noticia|noticias|noticiario|aconteceu|manchetes|ultimas)\b/.test(q))
    return { kind: "news", ttlMs: 300_000 };
  if (/\b(preco|precos|oferta|ofertas|promocao|promocoes|comprar|custa)\b/.test(q))
    return { kind: "prices", ttlMs: 300_000 };
  if (/\b(evento|eventos|show|shows|festival|programacao|cinema|exposicao)\b/.test(q))
    return { kind: "events", ttlMs: 3_600_000 };
  if (/\b(endereco|horario|horarios|restaurante|restaurantes|museu|telefone|abre|fecha)\b/.test(q))
    return { kind: "places", ttlMs: 21_600_000 };
  return { kind: "general", ttlMs: 900_000 };
}
export function cacheKey(query: string, context: SearchContext, now = new Date()): string {
  const canonical = query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[?!.,]+$/, "")
    .replace(/\s+/g, " ");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return createHash("sha256")
    .update(
      JSON.stringify([
        "v2",
        context.homeId ?? context.endpointId,
        normalize(context.city),
        context.timezone,
        day,
        context.period?.from,
        context.period?.to,
        context.presentation,
        context.flight,
        canonical,
      ]),
    )
    .digest("hex");
}
type Cached = { reply: Reply; expiresAt: number };
type Pending = { controller: AbortController; promise: Promise<Reply>; waiters: number };

export class SearchCache {
  private entries = new Map<string, Cached>();
  private pending = new Map<string, Pending>();
  get size() {
    this.prune();
    return this.entries.size;
  }
  private prune() {
    for (const [key, value] of this.entries)
      if (value.expiresAt <= Date.now()) this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
    for (const value of this.pending.values()) value.controller.abort();
    this.pending.clear();
  }
  async getOrSearch(
    key: string,
    ttl: number,
    enabled: boolean,
    fresh: boolean,
    signal: AbortSignal,
    task: (signal: AbortSignal) => Promise<Reply>,
  ): Promise<Reply> {
    signal.throwIfAborted();
    this.prune();
    const cached = enabled && !fresh ? this.entries.get(key) : undefined;
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return this.mark(cached.reply, "hit", cached.expiresAt);
    }
    let pending = this.pending.get(key);
    if (pending?.controller.signal.aborted) {
      this.pending.delete(key);
      pending = undefined;
    }
    const shared = Boolean(pending);
    if (!pending) {
      if (this.pending.size >= 8)
        throw new DomainError("Há muitas pesquisas em andamento. Aguarde um instante.");
      const controller = new AbortController();
      const created: Pending = {
        controller,
        waiters: 0,
        promise: Promise.resolve({ text: "", expression: "neutral" }),
      };
      created.promise = Promise.resolve()
        .then(() => task(controller.signal))
        .then((reply) => {
          controller.signal.throwIfAborted();
          const expiresAt = Date.now() + ttl;
          const marked = this.mark(reply, "fresh", expiresAt);
          if (enabled) {
            this.entries.delete(key);
            this.entries.set(key, { reply: marked, expiresAt });
            while (this.entries.size > SEARCH_CACHE_MAX)
              this.entries.delete(this.entries.keys().next().value as string);
          }
          return marked;
        })
        .finally(() => {
          if (this.pending.get(key) === created) this.pending.delete(key);
        });
      this.pending.set(key, created);
      pending = created;
    }
    const reply = await this.wait(pending, signal);
    return this.mark(reply, shared ? "shared" : "fresh");
  }
  private mark(reply: Reply, mode: "hit" | "shared" | "fresh", expiresAt?: number): Reply {
    const copy = structuredClone(reply);
    if (copy.web)
      copy.web = {
        ...copy.web,
        cache: mode,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      };
    return copy;
  }
  private async wait(pending: Pending, signal: AbortSignal): Promise<Reply> {
    pending.waiters++;
    let abort = () => {};
    try {
      return await new Promise<Reply>((resolve, reject) => {
        abort = () => reject(signal.reason ?? new Error("Search cancelled"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        pending.promise.then(resolve, reject);
      });
    } finally {
      signal.removeEventListener("abort", abort);
      if (--pending.waiters === 0) pending.controller.abort();
    }
  }
}
