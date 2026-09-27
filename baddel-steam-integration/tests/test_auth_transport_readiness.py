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
from steam_network.enums import UserActionRequired
from steam_network.websocket_client import AuthCall, WebSocketClient


class UserCache:
    def __init__(self):
        self.account_username = "account"
        self.steam_id = 76561190000000000
        self.refresh_token = "refresh-token"

    def from_dict(self, _credentials):
        return None

    def is_initialized(self):
        return True

    def Clear(self):
        self.account_username = None
        self.steam_id = None
        self.refresh_token = None


class WaitingWebSocket:
    def __init__(self, ready):
        self.ready = ready
        self.wait_calls = []
        self.communication_queues = {"websocket": asyncio.Queue(), "plugin": asyncio.Queue()}

    async def wait_until_connected(self, timeout):
        self.wait_calls.append(timeout)
        return self.ready


@pytest.mark.asyncio
async def test_token_auth_waits_for_transport_before_queueing_request():
    bridge = object.__new__(BaddelSteamBridge)
    bridge._user_info_cache = UserCache()
    bridge._websocket_client = WaitingWebSocket(True)

    async def auth_step(self):
        return UserActionRequired.InvalidAuthData

    bridge._get_auth_step = MethodType(auth_step, bridge)
    result = await bridge._authenticate_with_token({"refresh_token": "stored"})
    request = bridge._websocket_client.communication_queues["websocket"].get_nowait()

    assert bridge._websocket_client.wait_calls == [180]
    assert request == {"mode": AuthCall.TOKEN, "username": "account", "steam_id": 76561190000000000, "refresh_token": "refresh-token"}
    assert result["status"] == "need_login"


@pytest.mark.asyncio
async def test_transport_timeout_does_not_leave_a_stale_token_request():
    bridge = object.__new__(BaddelSteamBridge)
    bridge._user_info_cache = UserCache()
    bridge._websocket_client = WaitingWebSocket(False)

    result = await bridge._authenticate_with_token({"refresh_token": "stored"})

    assert result["status"] == "need_login"
    assert bridge._websocket_client.communication_queues["websocket"].empty()


@pytest.mark.asyncio
async def test_token_request_uses_identity_snapshot_if_shared_cache_is_cleared():
    client = object.__new__(WebSocketClient)
    client.communication_queues = {"websocket": asyncio.Queue(), "plugin": asyncio.Queue()}
    client._user_info_cache = SimpleNamespace(account_username=None, steam_id=None, refresh_token=None)
    client._steam_polling_data = None
    calls = []

    class Protocol:
        async def finalize_login(self, username, steam_id, refresh_token, _lost):
            calls.append((username, steam_id, refresh_token))
            return UserActionRequired.NoActionRequired

    async def get_protocol(self, _action):
        return Protocol()

    client._get_protocol_client = MethodType(get_protocol, client)
    await client.communication_queues["websocket"].put({"mode": AuthCall.TOKEN, "username": "account", "steam_id": 76561190000000000, "refresh_token": "refresh-token"})
    lost = asyncio.get_running_loop().create_future()

    await client._all_auth_calls(lost)

    assert calls == [("account", 76561190000000000, "refresh-token")]
    assert client.communication_queues["plugin"].get_nowait()["auth_result"] == UserActionRequired.NoActionRequired
