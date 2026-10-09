"""Validated speech and display metadata from a single conversation turn."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Expression = Literal[
    "neutral",
    "happy",
    "sad",
    "angry",
    "surprised",
    "curious",
    "confused",
    "excited",
    "shy",
    "skeptical",
    "proud",
    "affectionate",
]


class Reply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=2500)
    expression: Expression

    @classmethod
    def plain(cls, text):
        return cls(text=text, expression="curious" if text.rstrip().endswith("?") else "neutral")
