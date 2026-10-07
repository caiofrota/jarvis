import pytest

from server.pairing import Pairing


def test_pairing_code_is_single_use_and_scoped_to_robot():
    pairing = Pairing()
    code = pairing.issue("desk")
    assert len(code) == 6
    assert pairing.redeem(code, "fixture") == "desk"
    with pytest.raises(ValueError):
        pairing.redeem(code, "fixture")


def test_reissuing_invalidates_previous_code_and_limits_guesses():
    pairing = Pairing()
    old = pairing.issue("desk")
    pairing.issue("desk")
    with pytest.raises(ValueError):
        pairing.redeem(old, "fixture")
    for _ in range(9):
        with pytest.raises(ValueError):
            pairing.redeem("invalid", "fixture")
    with pytest.raises(RuntimeError):
        pairing.redeem("invalid", "fixture")


def test_pairing_expiration(monkeypatch):
    from server import pairing as module

    monkeypatch.setattr(module.time, "monotonic", lambda: 1)
    pairing = Pairing()
    code = pairing.issue("desk")
    monkeypatch.setattr(module.time, "monotonic", lambda: 302)
    with pytest.raises(ValueError):
        pairing.redeem(code, "fixture")
