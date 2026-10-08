/** Public connection policy shared by native companions. No server configuration or credentials. */
export function companionOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Informe um endereço HTTPS válido para o servidor.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/studio", "/studio/"].includes(url.pathname)
  )
    throw new Error(
      "Use o endereço HTTPS do servidor, sem senha, parâmetros ou caminhos adicionais.",
    );
  return url.origin;
}
export function sameServer(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}
export function externalWebLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function systemAccountSetup(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === origin && url.pathname === "/integrations";
  } catch {
    return false;
  }
}

export const companionUserAgent = "JarvisCompanion/0.1";
export function isNativeCompanion(userAgent: string): boolean {
  return userAgent.split(/\s+/).includes(companionUserAgent);
}
