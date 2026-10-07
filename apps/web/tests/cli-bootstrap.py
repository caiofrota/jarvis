"""Exercise the actual bootstrap terminal without exposing fixture passwords."""
import os
import pty
import select
import subprocess
import sys
import time

master, slave = pty.openpty()
child = subprocess.Popen(
    [sys.argv[1], "--import", "tsx", "tools/create-first-user.ts"],
    stdin=slave, stdout=slave, stderr=slave,
)
os.close(slave)
output = b""
deadline = time.monotonic() + 30


def wait_for(prompt: bytes):
    global output
    while prompt not in output:
        if time.monotonic() >= deadline:
            raise RuntimeError("Bootstrap terminal timed out")
        if select.select([master], [], [], 0.1)[0]:
            output += os.read(master, 8192)


try:
    for prompt, reply in [
        (b"Nome: ", b"CLI owner"),
        (b"Usu\xc3\xa1rio: ", b"cli-admin"),
        (b"caracteres): ", b"terminal-fixture-password"),
        (b"Repita a senha: ", b"terminal-fixture-password"),
    ]:
        wait_for(prompt)
        os.write(master, reply + b"\n")
    wait_for(b"Primeiro administrador criado.")
    assert child.wait(timeout=10) == 0
    assert b"terminal-fixture-password" not in output, "Password was echoed"
    print("Interactive bootstrap succeeded; password was never echoed")
finally:
    if child.poll() is None:
        child.kill()
        child.wait(timeout=5)
    os.close(master)
