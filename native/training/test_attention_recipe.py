"""Recipe invariants that do not need model dependencies or an accelerator."""

import copy
import json
import unittest
from pathlib import Path

if __package__:
    from .generate_attention_corpus import jobs_for
else:
    from generate_attention_corpus import jobs_for


class AttentionRecipeTests(unittest.TestCase):
    def setUp(self):
        self.recipe = json.loads(Path(__file__).with_name("rosie_attention.json").read_text())
        self.jobs = jobs_for(self.recipe)

    def test_source_voices_cannot_cross_splits(self):
        recipe = copy.deepcopy(self.recipe)
        recipe["voice_groups"]["testing"].append(recipe["voice_groups"]["training"][0])
        with self.assertRaisesRegex(ValueError, "leakage"):
            jobs_for(recipe)

    def test_each_phrase_name_and_greeting_accent_has_held_out_examples(self):
        for split in ("training", "validation", "testing"):
            for prefix in self.recipe["wake_prefixes"]:
                for name in self.recipe["names"]:
                    self.assertTrue(
                        any(
                            item["split"] == split
                            and item["phrase"] == prefix["phrase"]
                            and item["accent"] == prefix["variant"]
                            and item["variant"] == name["id"]
                            for item in self.jobs
                        )
                    )

    def test_acoustic_stop_requires_address_and_keeps_para_commands_negative(self):
        stops = {item["phrase"] for item in self.jobs if item["class_key"] == "stop"}
        self.assertEqual(stops, {"Rosie, para", "Para, Rosie"})
        for phrase in ("Para", "Cancelar", "Cancele", "Ar para vinte e dois", "É para amanhã"):
            self.assertTrue(
                any(
                    item["phrase"] == phrase and item["class_key"] == "negative"
                    for item in self.jobs
                )
            )

    def test_job_ids_are_unique_and_deterministic(self):
        self.assertEqual(self.jobs, jobs_for(self.recipe))
        self.assertEqual(len(self.jobs), len({item["file"] for item in self.jobs}))
        self.assertEqual(len(self.jobs), 1560)

    def test_explicit_name_negatives_cover_both_names_in_every_split(self):
        recipe = json.loads(Path(__file__).with_name("attention_name_negatives.json").read_text())
        jobs = jobs_for(recipe)
        self.assertEqual(len(jobs), 120)
        self.assertTrue(all(item["class_key"] == "negative" for item in jobs))
        for split in self.recipe["voice_groups"]:
            for name in self.recipe["names"]:
                self.assertTrue(
                    any(
                        item["split"] == split and item["phonemes"] == name["phonemes"]
                        for item in jobs
                    )
                )


if __name__ == "__main__":
    unittest.main()
