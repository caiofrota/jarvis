import contextlib
import io
import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


class VoiceWorkerTests(unittest.TestCase):
    def test_transcription_provides_name_hint_without_rewriting_decoded_text(self):
        transcripts = [
            "E aí Jarvis, tudo bem?",
            "Eu já vi tudo, bem obrigado.",
            "",
            "Fazer uma atividade desconhecida",
        ]
        calls = []
        models = []

        class WhisperModel:
            def __init__(self, *args, **kwargs):
                models.append((args, kwargs))

            def transcribe(self, audio, **kwargs):
                calls.append(kwargs)
                text = transcripts[len(calls) - 1]
                segments = (
                    [
                        SimpleNamespace(
                            text=text,
                            no_speech_prob=0.1,
                            avg_logprob=-1.5 if len(calls) == 4 else -0.2,
                            compression_ratio=1,
                        )
                    ]
                    if text
                    else []
                )
                return iter(segments), SimpleNamespace(duration=1)

        module = ModuleType("faster_whisper")
        module.WhisperModel = WhisperModel
        vocabulary = ["Assistente Exemplo", "Produto Novo 2030", "Editor Diferente"]
        context = ["Preparar uma refeição", "Revisar o documento"]
        request = (
            json.dumps({"op": "transcribe", "audio": "AAAA", "vocabulary": vocabulary, "context": context})
            + "\n"
        )
        output = io.StringIO()
        worker = Path(__file__).resolve().parents[2] / "voice" / "worker.py"
        with (
            tempfile.TemporaryDirectory() as root,
            patch.dict(os.environ),
            patch.dict("sys.modules", {"faster_whisper": module}),
            patch("sys.argv", [str(worker), root]),
            patch("sys.stdin", io.StringIO(request * len(transcripts))),
            contextlib.redirect_stdout(output),
        ):
            runpy.run_path(str(worker), run_name="__main__")

        results = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([result["value"]["text"] for result in results], transcripts)
        self.assertTrue(all(result["ok"] for result in results))
        self.assertEqual(len(models), 1)
        self.assertEqual([result["value"]["needsReview"] for result in results], [False, False, False, True])
        for call in calls:
            self.assertEqual(
                call["hotwords"],
                ", ".join(context + vocabulary),
            )
            self.assertEqual(call["language"], "pt")
            self.assertFalse(call["condition_on_previous_text"])
            self.assertTrue(call["vad_filter"])


if __name__ == "__main__":
    unittest.main()
