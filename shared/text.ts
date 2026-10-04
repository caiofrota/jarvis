export function withoutEmoji(text: unknown) {
  return String(text).replace(
    /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]/gu,
    '',
  );
}
export function forSpeech(text: unknown) {
  return withoutEmoji(text)
    .replace(/```[\s\S]*?```/g, ' Trecho de código omitido na leitura. ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\b_([^_\n]+)_\b/g, '$1')
    .replace(/(\d)\s*\*\s*(?=\d)/g, '$1 vezes ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
