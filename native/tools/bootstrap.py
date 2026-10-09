"""Create an empty household and an initial robot without real MQTT actions."""

import secrets
from pathlib import Path

from server.catalog import Catalog
from server.intent_examples import EXPRESSION_INTENTS
from server.store import Store

root = Path(__file__).resolve().parents[1]
store = Store(root / "data")
if store.path.exists():
    raise SystemExit("A configuration exists; use the panel to edit it.")
store.save(
    Catalog.model_validate(
        {
            "settings": {"mqtt_host": "192.168.20.13"},
            "rooms": [{"id": "configure-room", "name": "Definir cômodo"}],
            "robots": [
                {
                    "id": "rosie",
                    "name": "Rosie",
                    "room": "configure-room",
                    "token": secrets.token_urlsafe(24),
                }
            ],
            "intents": [
                *EXPRESSION_INTENTS,
                {
                    "id": "greeting",
                    "name": "Bom dia",
                    "phrases": ["Bom dia", "Bom dia Rosie"],
                    "expression": "happy",
                    "responses": [
                        "Bom dia!",
                        "Bom dia! Espero que seu dia seja bom.",
                    ],
                },
                {
                    "id": "thanks",
                    "name": "Agradecimento",
                    "phrases": ["Obrigado", "Obrigada", "Valeu Rosie"],
                    "responses": [
                        "Disponha!",
                        "Por nada!",
                    ],
                },
            ],
        }
    )
)
print("Initial catalog created. Admin password: native/data/admin.token (kept out of Git).")
