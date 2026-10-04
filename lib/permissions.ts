import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
function isAppURL(url: string, entry: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const normalize = (p: string) =>
      process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    return normalize(fileURLToPath(parsed)) === normalize(entry);
  } catch {
    return false;
  }
}
interface MediaDetails {
  isMainFrame?: boolean;
  requestingUrl?: string;
  mediaTypes?: string[];
  mediaType?: string;
}
class MicrophoneGate {
  entry: string;
  now: () => number;
  leases: Map<number, number>;
  constructor(entry: string, now = Date.now) {
    this.entry = entry;
    this.now = now;
    this.leases = new Map();
  }
  set(id: number, enabled: boolean) {
    if (enabled === true) this.leases.set(id, this.now() + 75000);
    else this.leases.delete(id);
    return true;
  }
  allows(
    contents: Pick<Electron.WebContents, 'id' | 'isDestroyed' | 'getURL'> | null,
    permission: string,
    details: MediaDetails,
    kind: 'request' | 'check',
  ) {
    try {
      if (
        permission !== 'media' ||
        !contents ||
        contents.isDestroyed() ||
        (this.leases.get(contents.id) || 0) <= this.now() ||
        !this.leases.has(contents.id) ||
        details?.isMainFrame !== true ||
        !isAppURL(contents.getURL(), this.entry) ||
        !isAppURL(details.requestingUrl || '', this.entry)
      )
        return false;
      return kind === 'request'
        ? Array.isArray(details.mediaTypes) &&
            details.mediaTypes.length === 1 &&
            details.mediaTypes[0] === 'audio'
        : details.mediaType === 'audio';
    } catch {
      return false;
    }
  }
}
export { isAppURL, MicrophoneGate };
