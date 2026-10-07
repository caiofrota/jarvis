import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from server import app as module


def test_authenticated_reconnect_replaces_stale_socket_without_old_cleanup_clobbering_new(
    monkeypatch,
):
    async def run():
        robot = SimpleNamespace(id="fixture", token="fixture-token")
        monkeypatch.setattr(
            module,
            "store",
            SimpleNamespace(
                catalog=SimpleNamespace(robots=[robot]),
                event=Mock(),
            ),
        )
        monkeypatch.setattr(module, "sessions", {})
        conversation = SimpleNamespace(reset=Mock())
        monkeypatch.setattr(module, "conversation", conversation)

        class Socket:
            def __init__(self, token="fixture-token"):
                self.headers = {"authorization": "Bearer " + token}
                self.accept = AsyncMock()
                self.close = AsyncMock()
                self.entered = asyncio.Event()
                self.exit = asyncio.Event()

        class Session:
            def __init__(self, ws, robot_id):
                self.ws = ws
                self.job = None

            async def receive(self):
                self.ws.entered.set()
                await self.ws.exit.wait()

        monkeypatch.setattr(module, "Session", Session)
        old = Socket()
        old_task = asyncio.create_task(module.robot_ws(old, "fixture"))
        await asyncio.wait_for(old.entered.wait(), 1)
        old_session = module.sessions["fixture"]

        invalid = Socket("wrong-token")
        await module.robot_ws(invalid, "fixture")
        invalid.accept.assert_not_awaited()
        invalid.close.assert_awaited_once_with(code=1008)
        assert module.sessions["fixture"] is old_session
        old.close.assert_not_awaited()

        old_session.job = asyncio.create_task(asyncio.Event().wait())
        new = Socket()
        new_task = asyncio.create_task(module.robot_ws(new, "fixture"))
        await asyncio.wait_for(new.entered.wait(), 1)
        new_session = module.sessions["fixture"]
        assert new_session is not old_session
        old.close.assert_awaited_once_with(code=1012)
        resets = conversation.reset.call_count
        old.exit.set()
        await old_task
        assert old_session.job.cancelled()
        assert module.sessions["fixture"] is new_session
        assert conversation.reset.call_count == resets
        new.exit.set()
        await new_task
        assert not module.sessions
        assert conversation.reset.call_count == resets + 1

    asyncio.run(run())


def test_reconnect_claim_is_atomic_while_accept_is_pending(monkeypatch):
    async def run():
        robot = SimpleNamespace(id="fixture", token="fixture-token")
        monkeypatch.setattr(
            module,
            "store",
            SimpleNamespace(
                catalog=SimpleNamespace(robots=[robot]),
                event=Mock(),
            ),
        )
        monkeypatch.setattr(module, "sessions", {})
        monkeypatch.setattr(module, "conversation", SimpleNamespace(reset=Mock()))
        accepted = asyncio.Event()
        release = asyncio.Event()
        received = []

        class Session:
            def __init__(self, ws, robot_id):
                self.ws, self.job = ws, None

            async def receive(self):
                received.append(self.ws)
                await release.wait()

        monkeypatch.setattr(module, "Session", Session)

        async def slow_accept():
            accepted.set()
            await release.wait()

        old = SimpleNamespace(
            headers={"authorization": "Bearer fixture-token"}, accept=slow_accept, close=AsyncMock()
        )
        new = SimpleNamespace(headers=old.headers, accept=AsyncMock(), close=AsyncMock())
        first = asyncio.create_task(module.robot_ws(old, "fixture"))
        await accepted.wait()
        second = asyncio.create_task(module.robot_ws(new, "fixture"))
        for _ in range(20):
            if received:
                break
            await asyncio.sleep(0)
        assert received == [new]
        release.set()
        await asyncio.gather(first, second)
        assert received == [new]
        assert not module.sessions

    asyncio.run(run())
