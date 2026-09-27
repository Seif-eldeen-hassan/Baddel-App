import asyncio
import os
import sys
from types import MethodType, SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, "..", "src"))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from baddel_bridge import BaddelSteamBridge
from steam_network.enums import AuthCall, TwoFactorMethod, UserActionRequired


@pytest.mark.asyncio
async def test_resend_starts_fresh_password_challenge_and_only_then_reports_resent():
    bridge = object.__new__(BaddelSteamBridge)
    queue = asyncio.Queue()
    bridge._pending_password_login = ("account", "secret")
    bridge._last_email_challenge_at = 0.0
    bridge._websocket_client = SimpleNamespace(communication_queues={"websocket": queue})
    bridge._authentication_cache = SimpleNamespace(
        two_factor_allowed_methods=[(TwoFactorMethod.EmailCode, "email")]
    )

    async def auth_step(self):
        return UserActionRequired.TwoFactorRequired

    bridge._get_auth_step = MethodType(auth_step, bridge)
    result = await bridge.resend_steam_guard_email()
    request = await queue.get()

    assert request == {"mode": AuthCall.RSA_AND_LOGIN, "username": "account", "password": "secret"}
    assert result["status"] == "need_2fa"
    assert result["method"] == "email"
    assert result["resent"] is True


@pytest.mark.asyncio
async def test_resend_cooldown_does_not_start_an_auth_request():
    bridge = object.__new__(BaddelSteamBridge)
    queue = asyncio.Queue()
    bridge._pending_password_login = ("account", "secret")
    bridge._last_email_challenge_at = asyncio.get_running_loop().time()
    bridge._websocket_client = SimpleNamespace(communication_queues={"websocket": queue})

    result = await bridge.resend_steam_guard_email()

    assert result["status"] == "cooldown"
    assert result["retryAfterSeconds"] > 0
    assert queue.empty()


@pytest.mark.asyncio
async def test_resend_without_live_password_challenge_requires_login():
    bridge = object.__new__(BaddelSteamBridge)
    bridge._pending_password_login = None
    result = await bridge.resend_steam_guard_email()
    assert result["status"] == "need_login"

