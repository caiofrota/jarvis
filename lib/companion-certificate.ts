import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
export function acceptsCompanionCertificate(
  pem: string | Buffer,
  expected: string | Buffer,
  hostname: string,
  now = Date.now(),
): boolean {
  try {
    const certificate = new X509Certificate(pem),
      pinned = new X509Certificate(expected);
    const host = hostname.replace(/^\[|\]$/g, '');
    return (
      certificate.fingerprint256 === pinned.fingerprint256 &&
      new Date(certificate.validFrom).getTime() <= now &&
      now <= new Date(certificate.validTo).getTime() &&
      Boolean(isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host, { subject: 'never' }))
    );
  } catch {
    return false;
  }
}

/** Defer unrelated hosts to Chromium; a configured pin is mandatory for its host. */
export function companionCertificateDecision(
  hostname: string,
  expectedHostname: string,
  errorCode: number,
  certificate: string | Buffer,
  pinned: string | Buffer,
): number {
  if (hostname.replace(/^\[|\]$/g, '') !== expectedHostname.replace(/^\[|\]$/g, '')) return -3;
  if (!acceptsCompanionCertificate(certificate, pinned, hostname)) return -2;
  if (errorCode === 0) return -3;
  return errorCode === -202 ? 0 : -2;
}
