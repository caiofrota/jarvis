"""Short-lived, single-use LAN pairing codes. Device tokens stay internal."""

import secrets
import time
from collections import deque


class Pairing:
    def __init__(self):
        self.codes = {}
        self.attempts = deque(maxlen=1000)

    def issue(self, robot_id):
        now = time.monotonic()
        self.codes = {k: v for k, v in self.codes.items() if v[1] > now and v[0] != robot_id}
        while True:
            code = f"{secrets.randbelow(1000000):06d}"
            if code not in self.codes:
                break
        self.codes[code] = (robot_id, now + 300)
        return code

    def redeem(self, code, address):
        now = time.monotonic()
        while self.attempts and self.attempts[0][0] < now - 60:
            self.attempts.popleft()
        if sum(ip == address for _, ip in self.attempts) >= 10 or len(self.attempts) >= 100:
            raise RuntimeError("Aguarde um minuto antes de tentar novamente.")
        self.attempts.append((now, address))
        match = self.codes.pop(code, None)
        if match is None or match[1] <= now:
            raise ValueError("PIN inválido ou expirado. Gere outro no painel.")
        return match[0]
