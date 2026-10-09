import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import {
  calendarDraftSchema,
  type IntegrationApplication,
  type IntegrationStatus,
  integrationApplicationSchema,
  mailDraftSchema,
  type PersonalConnection,
  type PersonalProposal,
  type PersonalProvider,
} from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import * as oauth from "oauth4webapi";
import { z } from "zod";
import { PersonalProviderClient, providers } from "./providers";

const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string(),
  expiresAt: z.number(),
});
type Tokens = z.infer<typeof tokensSchema>;
type Application = { clientId: string; clientSecret: string };
type Link = PersonalConnection & {
  owner: string;
  subject: string;
  revision: string;
  clientId: string;
  encrypted: string;
};
type Challenge = {
  owner: string;
  provider: PersonalProvider;
  verifier: string;
  clientId: string;
  until: number;
  result?: { tokens: Tokens; identity: { subject: string; email: string; name: string } };
};
type Proposal = PersonalProposal & { owner: string; revision: string; until: number };
const connectionKey = (owner: string) => `personal-integrations:${owner}`;
const applicationKey = (provider: PersonalProvider) => `personal-integration-app:${provider}`;
const identityKey = (provider: PersonalProvider, subject: string) =>
  `personal-integration-identity:${provider}:${createHash("sha256").update(subject).digest("hex")}`;

export class PersonalIntegrations {
  private readonly key: Buffer;
  private challenges = new Map<string, Challenge>();
  private proposals = new Map<string, Proposal>();
  private refreshing = new Map<string, Promise<Tokens>>();
  readonly callback: string;
  constructor(
    private readonly repo: Repository,
    origin: string,
    credential: string,
    private readonly client = new PersonalProviderClient(),
  ) {
    this.key = createHash("sha256").update(`jarvis-personal-integrations\0${credential}`).digest();
    this.callback = new URL("/api/v1/personal-integrations/callback", origin).href;
  }
  private seal(value: unknown, context: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }
  private open(encrypted: string, context: string): unknown {
    const data = Buffer.from(encrypted, "base64url"),
      decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"),
    );
  }
  private async enabled(owner: string) {
    const user = await this.repo.db.user.findUnique({ where: { id: owner } });
    if (!user?.enabled) throw new DomainError("Conta indisponível.");
    return user;
  }
  private async application(provider: PersonalProvider): Promise<Application | null> {
    const row = await this.repo.db.setting.findUnique({ where: { id: applicationKey(provider) } });
    return row
      ? z
          .object({ clientId: z.string(), clientSecret: z.string() })
          .parse(this.open(String(row.data), applicationKey(provider)))
      : null;
  }
  private async links(owner: string): Promise<Link[]> {
    await this.enabled(owner);
    const row = await this.repo.db.setting.findUnique({ where: { id: connectionKey(owner) } });
    return row ? (row.data as unknown as Link[]) : [];
  }
  private async link(owner: string, id: string) {
    const link = (await this.links(owner)).find(
      (value) => value.id === id && value.owner === owner,
    );
    if (!link) throw new DomainError("Conexão pessoal não encontrada.");
    return link;
  }
  async status(owner: string, admin = false): Promise<IntegrationStatus> {
    const links = await this.links(owner),
      configured = await Promise.all(
        (["google", "microsoft"] as const).map(async (provider) => {
          const app = await this.application(provider);
          return {
            provider,
            configured: Boolean(app),
            ...(app ? { clientId: app.clientId } : {}),
          };
        }),
      );
    return {
      callback: this.callback,
      providers: configured.map(({ clientId, ...value }) => ({
        ...value,
        ...(admin && clientId ? { clientId } : {}),
      })),
      connections: links.map(({ id, provider, email, name, permissions, clientId }) => ({
        id,
        provider,
        email,
        name,
        permissions,
        reconnect:
          !configured.find((value) => value.provider === provider)?.configured ||
          (configured.find((value) => value.provider === provider)?.clientId !== undefined &&
            configured.find((value) => value.provider === provider)?.clientId !== clientId),
      })),
    };
  }
  async configure(owner: string, raw: IntegrationApplication) {
    const user = await this.enabled(owner);
    if (user.role !== "admin") throw new DomainError("Acesso administrativo necessário.");
    const input = integrationApplicationSchema.parse(raw),
      previous = await this.application(input.provider);
    const secret =
      input.clientSecret ?? (previous?.clientId === input.clientId ? previous.clientSecret : "");
    if (!secret) throw new DomainError("Informe o segredo do aplicativo.");
    const id = applicationKey(input.provider),
      encrypted = this.seal({ clientId: input.clientId, clientSecret: secret }, id);
    await this.repo.db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: owner } });
      if (!actor?.enabled || actor.role !== "admin")
        throw new DomainError("Acesso administrativo necessário.");
      await tx.setting.upsert({
        where: { id },
        create: { id, data: json(encrypted) },
        update: { data: json(encrypted) },
      });
    });
  }
  private prune() {
    for (const [id, value] of this.challenges)
      if (value.until < Date.now()) this.challenges.delete(id);
    for (const [id, value] of this.proposals)
      if (value.until < Date.now()) this.proposals.delete(id);
  }
  async begin(owner: string, provider: PersonalProvider) {
    await this.enabled(owner);
    this.prune();
    if (
      this.challenges.size >= 128 ||
      [...this.challenges.values()].filter((value) => value.owner === owner).length >= 3
    )
      throw new DomainError("Há conexões pendentes. Aguarde alguns minutos.");
    if ((await this.links(owner)).length >= 10)
      throw new DomainError("O limite é de dez contas conectadas por pessoa.");
    const app = await this.application(provider);
    if (!app)
      throw new DomainError("Um administrador precisa configurar o aplicativo deste provedor.");
    const verifier = oauth.generateRandomCodeVerifier(),
      state = oauth.generateRandomState();
    const url = new URL(String(providers[provider].server.authorization_endpoint));
    url.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: this.callback,
      response_type: "code",
      scope: providers[provider].scopes,
      state,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      ...(provider === "google"
        ? { access_type: "offline", prompt: "consent select_account" }
        : { prompt: "select_account" }),
    }).toString();
    this.challenges.set(state, {
      owner,
      provider,
      verifier,
      clientId: app.clientId,
      until: Date.now() + 10 * 60000,
    });
    return { url: url.href };
  }
  async callbackResult(url: URL) {
    this.prune();
    const state = url.searchParams.get("state") ?? "",
      challenge = this.challenges.get(state);
    if (!challenge || challenge.result)
      throw new DomainError("A autorização expirou ou já foi utilizada.");
    // Consume before exchanging the single-use authorization code. The continuation is owner-bound.
    this.challenges.delete(state);
    const app = await this.application(challenge.provider);
    if (!app || app.clientId !== challenge.clientId)
      throw new DomainError("O aplicativo mudou. Inicie outra conexão.");
    const server = providers[challenge.provider].server,
      client = { client_id: app.clientId };
    const params = oauth.validateAuthResponse(server, client, url.searchParams, state);
    const response = await oauth.authorizationCodeGrantRequest(
      server,
      client,
      oauth.ClientSecretPost(app.clientSecret),
      params,
      this.callback,
      challenge.verifier,
      { [oauth.customFetch]: this.client.fetcher, signal: AbortSignal.timeout(20000) },
    );
    const result = await oauth.processAuthorizationCodeResponse(server, client, response);
    const tokens = tokensSchema.parse({
      ...result,
      scope: result.scope ?? providers[challenge.provider].scopes,
      expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
    });
    if (!tokens.refresh_token)
      throw new DomainError(
        "O provedor não autorizou acesso contínuo. Inicie outra conexão e aceite o acesso solicitado.",
      );
    const identity = await this.client.identity(challenge.provider, tokens.access_token);
    const continuation = oauth.generateRandomState();
    this.challenges.set(continuation, {
      ...challenge,
      until: Date.now() + 5 * 60000,
      result: { tokens, identity },
    });
    return continuation;
  }
  async finish(owner: string, state: string) {
    this.prune();
    await this.enabled(owner);
    const challenge = this.challenges.get(state);
    if (!challenge?.result || challenge.owner !== owner)
      throw new DomainError("A autorização não pertence à sua conta ou expirou.");
    this.challenges.delete(state);
    const app = await this.application(challenge.provider);
    if (app?.clientId !== challenge.clientId)
      throw new DomainError("O aplicativo mudou. Inicie outra conexão.");
    const { tokens, identity } = challenge.result;
    await this.repo.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: owner } });
      if (!user?.enabled) throw new DomainError("Conta indisponível.");
      const identityId = identityKey(challenge.provider, identity.subject),
        reserved = await tx.setting.findUnique({ where: { id: identityId } });
      if (reserved && reserved.data !== owner)
        throw new DomainError("Essa conta já está vinculada a outro usuário do Jarvis.");
      const id = connectionKey(owner),
        row = await tx.setting.findUnique({ where: { id } }),
        links = row ? (row.data as unknown as Link[]) : [];
      const previous = links.find(
          (link) => link.provider === challenge.provider && link.subject === identity.subject,
        ),
        connectionId = previous?.id ?? randomUUID();
      if (!previous && links.length >= 10)
        throw new DomainError("O limite é de dez contas conectadas por pessoa.");
      const link: Link = {
        id: connectionId,
        owner,
        provider: challenge.provider,
        ...identity,
        permissions: tokens.scope.split(/\s+/),
        reconnect: false,
        revision: randomUUID(),
        clientId: challenge.clientId,
        encrypted: this.seal(tokens, `${owner}:${connectionId}`),
      };
      const next = [...links.filter((value) => value.id !== connectionId), link];
      await tx.setting.upsert({
        where: { id },
        create: { id, data: json(next) },
        update: { data: json(next) },
      });
      await tx.setting.upsert({
        where: { id: identityId },
        create: { id: identityId, data: json(owner) },
        update: { data: json(owner) },
      });
    });
  }
  async disconnect(owner: string, connectionId: string) {
    const link = await this.link(owner, connectionId);
    await this.repo.db.$transaction(async (tx) => {
      const id = connectionKey(owner),
        row = await tx.setting.findUnique({ where: { id } }),
        links = (row?.data as unknown as Link[]) ?? [];
      await tx.setting.update({
        where: { id },
        data: { data: json(links.filter((value) => value.id !== connectionId)) },
      });
      await tx.setting.deleteMany({ where: { id: identityKey(link.provider, link.subject) } });
    });
    for (const [id, value] of this.proposals)
      if (value.owner === owner && value.connectionId === connectionId) this.proposals.delete(id);
  }
  private permission(link: Link, action: "read" | "send" | "calendar") {
    const scope =
      link.provider === "google"
        ? `https://www.googleapis.com/auth/${action === "read" ? "gmail.readonly" : action === "send" ? "gmail.send" : "calendar.events"}`
        : action === "read"
          ? "Mail.Read"
          : action === "send"
            ? "Mail.Send"
            : "Calendars.ReadWrite";
    if (!link.permissions.some((value) => value.toLowerCase() === scope.toLowerCase()))
      throw new DomainError("Esta conta não autorizou essa operação. Conecte novamente.");
  }
  private async token(link: Link): Promise<string> {
    const app = await this.application(link.provider);
    if (!app || app.clientId !== link.clientId)
      throw new DomainError("O aplicativo mudou. Conecte a conta novamente.");
    const tokens = tokensSchema.parse(this.open(link.encrypted, `${link.owner}:${link.id}`));
    if (tokens.expiresAt > Date.now() + 60000) return tokens.access_token;
    const key = `${link.owner}:${link.id}`;
    let pending = this.refreshing.get(key);
    if (!pending) {
      pending = (async () => {
        if (!tokens.refresh_token) throw new DomainError("Conecte a conta novamente.");
        const server = providers[link.provider].server,
          client = { client_id: app.clientId };
        const response = await oauth.refreshTokenGrantRequest(
          server,
          client,
          oauth.ClientSecretPost(app.clientSecret),
          tokens.refresh_token,
          { [oauth.customFetch]: this.client.fetcher, signal: AbortSignal.timeout(20000) },
        );
        const value = await oauth.processRefreshTokenResponse(server, client, response);
        const next = tokensSchema.parse({
          ...tokens,
          ...value,
          scope: value.scope ?? tokens.scope,
          refresh_token: value.refresh_token ?? tokens.refresh_token,
          expiresAt: Date.now() + (value.expires_in ?? 3600) * 1000,
        });
        await this.repo.db.$transaction(async (tx) => {
          const id = connectionKey(link.owner),
            row = await tx.setting.findUnique({ where: { id } }),
            links = (row?.data as unknown as Link[]) ?? [];
          const current = links.find((value) => value.id === link.id);
          if (!current || current.revision !== link.revision)
            throw new DomainError("A conexão mudou. Tente novamente.");
          await tx.setting.update({
            where: { id },
            data: {
              data: json(
                links.map((value) =>
                  value.id === link.id
                    ? {
                        ...value,
                        encrypted: this.seal(next, key),
                        permissions: next.scope.split(/\s+/),
                      }
                    : value,
                ),
              ),
            },
          });
        });
        return next;
      })();
      this.refreshing.set(key, pending);
    }
    try {
      return (await pending).access_token;
    } finally {
      if (this.refreshing.get(key) === pending) this.refreshing.delete(key);
    }
  }
  async read(
    owner: string,
    connectionId: string,
    resource: "inbox" | "message" | "calendars" | "events",
    itemId = "",
  ) {
    const link = await this.link(owner, connectionId);
    this.permission(link, resource === "inbox" || resource === "message" ? "read" : "calendar");
    const token = await this.token(link);
    if (resource === "inbox") return this.client.inbox(link.provider, token);
    if (resource === "message") return this.client.message(link.provider, token, itemId);
    if (resource === "calendars") return this.client.calendars(link.provider, token);
    return this.client.events(link.provider, token, itemId);
  }
  async propose(
    owner: string,
    connectionId: string,
    kind: "mail" | "calendar",
    raw: unknown,
  ): Promise<PersonalProposal> {
    this.prune();
    if (this.proposals.size >= 128)
      throw new DomainError("Há muitas ações pendentes. Aguarde alguns minutos.");
    const link = await this.link(owner, connectionId);
    this.permission(link, kind === "mail" ? "send" : "calendar");
    const draft = kind === "mail" ? mailDraftSchema.parse(raw) : calendarDraftSchema.parse(raw);
    if (kind === "calendar") {
      const calendars = await this.client.calendars(link.provider, await this.token(link));
      if (
        !calendars.some(
          (value) =>
            value.id === (draft as z.infer<typeof calendarDraftSchema>).calendarId &&
            value.writable,
        )
      )
        throw new DomainError("Escolha uma agenda que permita criar compromissos.");
    }
    const proposal: Proposal = {
      id: randomUUID(),
      owner,
      connectionId,
      revision: link.revision,
      account: link.email,
      kind,
      draft,
      until: Date.now() + 5 * 60000,
    };
    this.proposals.set(proposal.id, proposal);
    const { owner: _owner, revision: _revision, until: _until, ...publicProposal } = proposal;
    return publicProposal;
  }
  async confirm(owner: string, id: string) {
    this.prune();
    const proposal = this.proposals.get(id);
    if (!proposal || proposal.owner !== owner)
      throw new DomainError("A confirmação expirou ou não pertence à sua conta.");
    this.proposals.delete(id);
    const link = await this.link(owner, proposal.connectionId);
    if (link.revision !== proposal.revision)
      throw new DomainError("A conexão mudou. Prepare a ação novamente.");
    this.permission(link, proposal.kind === "mail" ? "send" : "calendar");
    const token = await this.token(link);
    if (proposal.kind === "calendar") {
      const calendars = await this.client.calendars(link.provider, token);
      if (
        !calendars.some(
          (value) =>
            value.id === (proposal.draft as z.infer<typeof calendarDraftSchema>).calendarId &&
            value.writable,
        )
      )
        throw new DomainError("Essa agenda não permite criar compromissos.");
    }
    await this.enabled(owner);
    const current = await this.link(owner, link.id);
    if (current.revision !== proposal.revision)
      throw new DomainError("A conexão mudou. Prepare a ação novamente.");
    try {
      if (proposal.kind === "mail")
        await this.client.send(link.provider, token, mailDraftSchema.parse(proposal.draft));
      else
        await this.client.createEvent(
          link.provider,
          token,
          calendarDraftSchema.parse(proposal.draft),
        );
    } catch {
      throw new DomainError(
        proposal.kind === "mail"
          ? "Não foi possível confirmar o envio. Confira a pasta Enviados antes de tentar novamente."
          : "Não foi possível confirmar a criação. Confira a agenda antes de tentar novamente.",
      );
    }
    return {
      message:
        proposal.kind === "mail" ? "Envio aceito pelo provedor." : "Criação aceita pelo provedor.",
    };
  }
}
