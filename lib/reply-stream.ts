import { parseDecision } from './chat-decision';

/** Only prose is streamed. Actions always wait for the complete validated envelope. */
export class ReplyStream {
  text = '';
  constructor(private emit: (text: string) => void) {}

  push(raw: string) {
    const prefix = /^\s*\{\s*"decision"\s*:\s*\{\s*"type"\s*:\s*"reply"\s*,\s*"text"\s*:\s*"/.exec(raw);
    if (!prefix) return;
    const start = prefix[0].length;
    let end = start,
      closed = false;
    while (end < raw.length) {
      if (raw[end] === '"') {
        closed = true;
        break;
      }
      if (raw[end] === '\\') {
        const length = raw[end + 1] === 'u' ? 6 : 2;
        if (end + length > raw.length) break;
        end += length;
      } else end++;
    }
    let decoded: string;
    try {
      decoded = JSON.parse('"' + raw.slice(start, end) + '"');
    } catch {
      return;
    }
    // Whole sentences allow validation before exposing or speaking a claim.
    const boundary = [...decoded.matchAll(/[.!?](?:\s|$)/g)].at(-1);
    if (!closed && !boundary) return;
    const candidate = closed ? decoded : decoded.slice(0, boundary!.index! + 1);
    try {
      const decision = parseDecision(JSON.stringify({ decision: { type: 'reply', text: candidate } }));
      if (decision.type !== 'reply' || !decision.text.startsWith(this.text)) return;
      const delta = decision.text.slice(this.text.length);
      if (delta) {
        this.text = decision.text;
        this.emit(delta);
      }
    } catch {
      /* Unvalidated claims remain buffered for the final decision validator. */
    }
  }

  pushPlain(raw: string, final = false) {
    const boundary = [...raw.matchAll(/[.!?](?:\s|$)/g)].at(-1);
    if (!final && !boundary) return;
    const candidate = final ? raw : raw.slice(0, boundary!.index! + 1);
    try {
      const decision = parseDecision(JSON.stringify({ decision: { type: 'reply', text: candidate } }));
      if (decision.type !== 'reply' || !decision.text.startsWith(this.text)) return;
      const delta = decision.text.slice(this.text.length);
      if (delta) {
        this.text = decision.text;
        this.emit(delta);
      }
    } catch {
      // Keep potentially unsafe or incomplete claims buffered until validation.
    }
  }
}
