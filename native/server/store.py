import json
import os
import secrets
import sqlite3
from pathlib import Path

from .catalog import Catalog


class Store:
    def __init__(self, directory: Path):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "catalog.json"
        self.token_path = directory / "admin.token"
        if not self.token_path.exists():
            self.token_path.write_text(secrets.token_urlsafe(24))
            self.token_path.chmod(0o600)
        self.admin_token = self.token_path.read_text().strip()
        self.catalog = (
            Catalog.model_validate_json(self.path.read_text()) if self.path.exists() else Catalog()
        )
        self.db = sqlite3.connect(directory / "events.sqlite", check_same_thread=False)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, "
            "time TEXT DEFAULT CURRENT_TIMESTAMP, kind TEXT, detail TEXT)"
        )

    def save(self, catalog: Catalog):
        temp = self.path.with_suffix(".tmp")
        with open(temp, "w", opener=lambda p, f: os.open(p, f, 0o600)) as f:
            f.write(catalog.model_dump_json(indent=2))
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.path)
        self.catalog = catalog

    def public(self):
        data = self.catalog.model_dump()
        for key in ("api_key", "mqtt_password"):
            data["settings"][key] = ""
        data["credentials"] = {
            "api_key": bool(self.catalog.settings.api_key),
            "mqtt_password": bool(self.catalog.settings.mqtt_password),
        }
        for robot in data["robots"]:
            robot["token"] = ""
        return data

    def event(self, kind, detail):
        self.db.execute(
            "INSERT INTO events(kind,detail) VALUES (?,?)",
            (kind, json.dumps(detail, ensure_ascii=False)),
        )
        self.db.execute("DELETE FROM events WHERE id < (SELECT MAX(id)-1000 FROM events)")
        self.db.commit()

    def events(self):
        return [
            {"time": t, "kind": k, "detail": json.loads(d)}
            for t, k, d in self.db.execute(
                "SELECT time,kind,detail FROM events ORDER BY id DESC LIMIT 80"
            )
        ]
