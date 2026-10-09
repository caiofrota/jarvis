const localNames: Record<string, string> = {
  "kokoro-pf_dora": "Dora",
  "pt_BR-faber-medium": "Faber",
  "pt_BR-cadu-medium": "Cadu",
};

export function voiceProvider(id: string) {
  if (id.startsWith("openai-")) return "OpenAI";
  if (id.startsWith("elevenlabs-")) return "ElevenLabs";
  if (id.startsWith("ha-cloud-")) return "Home Assistant Cloud";
  if (id.startsWith("kokoro-")) return "Local (Kokoro)";
  if (id.startsWith("supertonic-")) return "Local (Supertonic)";
  if (/^pt_BR-/.test(id)) return "Local (Piper)";
  return "Local";
}

export function voiceLabel(id: string, names: Record<string, string> = {}) {
  const provider = voiceProvider(id);
  const name =
    names[id] ??
    localNames[id] ??
    id.replace(/^(openai-|elevenlabs-|ha-cloud-|supertonic-)/, "").replace(/Neural$/, "");
  return name.endsWith(` · ${provider}`) ? name : `${name} · ${provider}`;
}
