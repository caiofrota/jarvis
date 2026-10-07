"""Display one offline experiment in its explicitly registered Herdr pane."""

import argparse
import json
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    last = None
    print(
        "Rosie: treinamento wake + parar | artefatos locais, sem instalação automática", flush=True
    )
    print(f"Experimento: {args.root}", flush=True)
    while True:
        states = {}
        for name in ("pipeline-status.json", "corpus-progress.json", "prosody-progress.json"):
            path = args.root / name
            if path.exists():
                try:
                    states[name] = json.loads(path.read_text())
                except (OSError, json.JSONDecodeError):
                    continue
        pipeline = states.get("pipeline-status.json", {})
        corpus = states.get("corpus-progress.json", {})
        phase = pipeline.get("phase", "preparação")
        if phase in ("waiting_for_corpus", "corpus_generation"):
            completed, total = corpus.get("completed", 0), corpus.get("total", 0)
            detail = f"Gerando dados: {completed}/{total}. Gradientes ainda não começaram."
            prosody = states.get("prosody-progress.json", {})
            if completed == total and prosody:
                detail = f"Variações sem pausa: {prosody.get('completed', 0)}/{prosody.get('total', 480)}; corpus principal completo."
        else:
            detail = (
                f"{phase} | {pipeline.get('target_class', '')} | "
                f"tentativa {pipeline.get('attempt', '-')} | "
                f"checkpoint até {pipeline.get('until_step', '-')} passos"
            )
            kind, attempt = pipeline.get("target_class"), pipeline.get("attempt")
            if kind and attempt:
                checkpoint = args.root / kind / f"attempt-{attempt:02d}/resume-state.json"
                if checkpoint.exists():
                    saved = json.loads(checkpoint.read_text())
                    detail += f" | salvo: {saved['step']}/8000"
        serialized = detail
        if serialized != last:
            print(time.strftime("%H:%M:%S"), serialized, flush=True)
            last = serialized
        if phase in ("complete", "needs_human_samples", "failed"):
            print("Job encerrado. Os resultados não selecionam nem instalam firmware.", flush=True)
            break
        time.sleep(10)


if __name__ == "__main__":
    main()
