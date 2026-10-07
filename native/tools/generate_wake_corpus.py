"""Build an experimental synthetic corpus with disjoint voice groups and traceable WAVs."""

import hashlib
import json
import os
import time
import wave
from math import gcd

import numpy as np
from misaki.espeak import EspeakG2P
from preview_wake_pronunciations import ROOT, load_voice
from scipy.signal import resample_poly

VOICE_GROUPS = {
    "training": ["pf_dora", "pm_alex", "af_heart", "af_bella", "am_michael", "am_adam"],
    "validation": ["pm_santa", "af_sarah"],
    "testing": ["af_nicole", "am_echo"],
}
SPEEDS = [0.8, 0.9, 1.0, 1.1, 1.2]
NORMAL_PHRASES = [
    "Bom dia",
    "Boa noite",
    "Que horas são",
    "Qual é a temperatura lá fora",
    "Liga a luz",
    "Apaga a luz do escritório",
    "Pode parar",
    "Pode dormir",
    "Conta uma piada",
    "Você fica brava",
    "Faz cara de feliz",
    "Muito obrigado",
    "Está tudo bem",
    "Eu vou sair agora",
    "Onde está meu celular",
    "Tem alguém na porta",
    "Vamos almoçar",
    "A televisão está ligada",
    "Eu não entendi",
    "Repete por favor",
    "O café está pronto",
    "Você conhece essa música",
    "Amanhã vai chover",
    "A janela está aberta",
]


def main():
    os.nice(15)
    recipe = json.loads((ROOT / "training/acorda_rosie.json").read_text())
    if not recipe.get("pronunciation_approval"):
        raise SystemExit("Pronunciation references have not been approved.")
    all_voices = [v for group in VOICE_GROUPS.values() for v in group]
    if len(all_voices) != len(set(all_voices)):
        raise SystemExit("A source voice cannot cross dataset splits.")
    output = ROOT / "artifacts/wake/acorda_rosie/corpus"
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "manifest.json"
    report = {
        "status": "experimental_synthetic_corpus_not_human_validation",
        "recipe": recipe,
        "voice_groups": VOICE_GROUPS,
        "samples": [],
    }
    if manifest.exists():
        report = json.loads(manifest.read_text())
        if report["recipe"] != recipe or report["voice_groups"] != VOICE_GROUPS:
            raise SystemExit(
                "Existing corpus belongs to a different recipe; preserve it separately."
            )
    completed = {item["file"]: item for item in report["samples"]}
    voice = load_voice()
    if set(all_voices) - set(voice.get_voices()):
        raise SystemExit("Required voice styles are missing.")
    g2p = EspeakG2P("pt-br")
    negatives = list(dict.fromkeys(recipe["hard_negative_texts"] + NORMAL_PHRASES))
    jobs = []
    for split, styles in VOICE_GROUPS.items():
        for style in styles:
            for prefix in recipe["prefixes"]:
                for name in recipe["names"]:
                    for speed in SPEEDS:
                        key = f"{style}-{prefix['id']}-{name['id']}-{speed:.1f}"
                        jobs.append(
                            (
                                split,
                                style,
                                key,
                                True,
                                name["id"],
                                speed,
                                prefix["phonemes"] + " " + name["phonemes"],
                            )
                        )
            for i, text in enumerate(negatives):
                phonemes, _ = g2p(text)
                jobs.append((split, style, f"{style}-negative-{i:02}", False, text, 1.0, phonemes))
    started = time.monotonic()
    for number, (split, style, key, label, variant, speed, phonemes) in enumerate(jobs, 1):
        filename = f"{split}/{'positive' if label else 'negative'}/{key}.wav"
        path = output / filename
        if filename in completed:
            if hashlib.sha256(path.read_bytes()).hexdigest() != completed[filename]["sha256"]:
                raise SystemExit(f"Changed corpus audio: {filename}")
            continue
        missing = set(phonemes) - set(voice.tokenizer.vocab)
        if missing:
            raise SystemExit(f"Unsupported phonemes in {key}: {missing}")
        samples, rate = voice.create(phonemes, style, speed=speed, is_phonemes=True)
        divisor = gcd(rate, 16000)
        pcm = resample_poly(samples, 16000 // divisor, rate // divisor)
        if not np.isfinite(pcm).all() or not 0.2 <= len(pcm) / 16000 <= 10:
            raise RuntimeError(f"Invalid synthesized clip: {key}")
        pcm = (np.clip(pcm, -1, 1) * 32767).astype("<i2")
        if not np.any(pcm):
            raise RuntimeError(f"Silent synthesized clip: {key}")
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(pcm.tobytes())
        report["samples"].append(
            {
                "file": filename,
                "split": split,
                "voice": style,
                "truth": label,
                "variant": variant,
                "speed": speed,
                "phonemes": phonemes,
                "duration_seconds": len(pcm) / 16000,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
        temporary = manifest.with_suffix(".tmp")
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(manifest)
        if number % 20 == 0:
            print(
                f"Generated {number}/{len(jobs)} clips in {time.monotonic() - started:.1f} s",
                flush=True,
            )
    print(
        f"Corpus ready: {len(report['samples'])} synthetic clips; human acceptance remains separate.",
        flush=True,
    )


if __name__ == "__main__":
    main()
