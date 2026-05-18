import asyncio
import os
import ssl
import sys
from contextlib import suppress
from types import SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, "..", "src"))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from baddel_bridge import BaddelSteamBridge
from persistent_cache_state import PersistentCacheState
from steam_network.authentication_cache import AuthenticationCache
from steam_network.enums import AuthCall, TwoFactorMethod, UserActionRequired
from steam_network.local_machine_cache import LocalMachineCache
from steam_network.steam_auth_polling_data import SteamPollingData
from steam_network.user_info_cache import UserInfoCache
from steam_network.websocket_client import WebSocketClient
import steam_network.websocket_client as websocket_client_module


class FakeProtocolClient:
    def __init__(self, user_info_cache: UserInfoCache, steam_id: int, persona_name: str):
        self._user_info_cache = user_info_cache
        self._steam_id = steam_id
        self._persona_name = persona_name
        self.calls = []
        self._run_event = asyncio.Event()

    async def run(self):
        self.calls.append(("run",))
        await self._run_event.wait()

    async def close(self, send_log_off=True):
        self.calls.append(("close", send_log_off))
        self._run_event.set()

    async def wait_closed(self):
        return None

    async def get_rsa_public_key(self, username, auth_lost_handler):
        self.calls.append(("rsa", username))
        return True, SimpleNamespace(rsa_public_key=object(), timestamp=123)

    async def authenticate_password(self, username, enciphered_password, timestamp, auth_lost_handler):
        self.calls.append(("password", username, enciphered_password))
        self._user_info_cache.steam_id = self._steam_id
        return SteamPollingData(
            10,
            self._steam_id,
            b"request-id",
            0.1,
            {TwoFactorMethod.EmailCode: "email"},
            "",
        )

    async def update_two_factor(self, client_id, steam_id, code, method, auth_lost_handler):
        self.calls.append(("update", client_id, steam_id, code, method))
        return UserActionRequired.NoActionConfirmLogin

    async def check_auth_status(self, client_id, request_id, is_confirm, auth_lost_handler):
        self.calls.append(("poll", client_id, request_id, is_confirm))
        self._user_info_cache.refresh_token = f"refresh-{self._steam_id}"
        return (UserActionRequired.NoActionConfirmToken, None)

    async def finalize_login(self, username, steam_id, refresh_token, auth_lost_handler):
        self.calls.append(("token", username, steam_id, refresh_token))
        self._user_info_cache.persona_name = self._persona_name
        return UserActionRequired.NoActionRequired


class ControlledWebSocketClient(WebSocketClient):
    def __init__(self, protocol_clients, authentication_cache=None, user_info_cache=None, local_machine_cache=None):
        super().__init__(
            websocket_list=SimpleNamespace(),
            ssl_context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT),
            friends_cache=SimpleNamespace(),
            games_cache=SimpleNamespace(),
            translations_cache={},
            stats_cache=SimpleNamespace(),
            times_cache=SimpleNamespace(),
            authentication_cache=authentication_cache or AuthenticationCache(),
            user_info_cache=user_info_cache or UserInfoCache(),
            local_machine_cache=local_machine_cache or LocalMachineCache({}, PersistentCacheState()),
        )
        self._protocol_clients = list(protocol_clients)

    async def _ensure_connected(self):
        if self._protocol_client is None:
            if not self._protocol_clients:
                raise AssertionError("No protocol clients left for test")
            self._protocol_client = self._protocol_clients.pop(0)

    async def _close_socket(self):
        self._websocket = None

    async def _close_protocol_client(self):
        if self._protocol_client is not None:
            await self._protocol_client.close(send_log_off=False)
            await self._protocol_client.wait_closed()
            self._protocol_client = None


@pytest.fixture(autouse=True)
def patch_encrypt(monkeypatch):
    monkeypatch.setattr(websocket_client_module, "encrypt", lambda password, key: b"cipher")


@pytest.mark.asyncio
async def test_two_factor_update_returns_invalid_auth_when_protocol_client_missing():
    auth_cache = AuthenticationCache()
    user_info_cache = UserInfoCache()
    client = ControlledWebSocketClient([], authentication_cache=auth_cache, user_info_cache=user_info_cache)
    client._steam_polling_data = SteamPollingData(
        7,
        42,
        b"request-id",
        0.1,
        {TwoFactorMethod.EmailCode: "email"},
        "",
    )

    auth_lost = asyncio.get_running_loop().create_future()
    auth_task = asyncio.create_task(client._all_auth_calls(auth_lost))

    await client.communication_queues["websocket"].put(
        {
            "mode": AuthCall.UPDATE_TWO_FACTOR,
            "two-factor-code": "123456",
            "two-factor-method": TwoFactorMethod.EmailCode,
        }
    )

    result = await asyncio.wait_for(client.communication_queues["plugin"].get(), 1)
    assert result["auth_result"] == UserActionRequired.InvalidAuthData

    auth_task.cancel()
    with suppress(asyncio.CancelledError):
        await auth_task


@pytest.mark.asyncio
async def test_email_auth_flow_completes_for_new_account():
    events = []

    async def push_event(name, data):
        events.append((name, data))

    bridge = BaddelSteamBridge(push_event)
    protocol_client = FakeProtocolClient(bridge._user_info_cache, 76561198000000001, "Fresh Account")
    bridge._websocket_client = ControlledWebSocketClient(
        [protocol_client],
        authentication_cache=bridge._authentication_cache,
        user_info_cache=bridge._user_info_cache,
        local_machine_cache=bridge._local_machine_cache,
    )

    initial = await bridge.authenticate(None)
    assert initial["status"] == "choose_login_method"

    login_end_uri = "https://example.invalid/login_finished?username=fresh_user&password=secret"
    login_result = await bridge.pass_login_credentials(login_end_uri, {"end_uri": login_end_uri})
    assert login_result["status"] == "need_2fa"
    assert login_result["method"] == "email"

    email_end_uri = "https://example.invalid/two_factor_mail_finished?code=123456"
    final_result = await bridge.pass_login_credentials(email_end_uri, {"end_uri": email_end_uri})
    assert final_result == {
        "status": "authenticated",
        "steamId": "76561198000000001",
        "personaName": "Fresh Account",
    }

    assert [call[0] for call in protocol_client.calls if call[0] != "run"] == [
        "rsa",
        "password",
        "update",
        "poll",
        "token",
    ]

    await bridge.logout()
    assert bridge._steam_run_task is None
    assert events == []


@pytest.mark.asyncio
async def test_logout_clears_pending_auth_before_importing_another_account():
    async def push_event(name, data):
        return None

    bridge = BaddelSteamBridge(push_event)
    old_protocol_client = FakeProtocolClient(bridge._user_info_cache, 76561198000000010, "Old Account")
    new_protocol_client = FakeProtocolClient(bridge._user_info_cache, 76561198000000020, "New Account")
    bridge._websocket_client = ControlledWebSocketClient(
        [old_protocol_client, new_protocol_client],
        authentication_cache=bridge._authentication_cache,
        user_info_cache=bridge._user_info_cache,
        local_machine_cache=bridge._local_machine_cache,
    )

    initial = await bridge.authenticate(None)
    assert initial["status"] == "choose_login_method"

    await asyncio.sleep(0)
    await bridge.logout()

    assert bridge._steam_run_task is None
    assert bridge._websocket_client.communication_queues["websocket"].qsize() == 0
    assert bridge._websocket_client.communication_queues["plugin"].qsize() == 0

    retry = await bridge.authenticate(None)
    assert retry["status"] == "choose_login_method"

    login_end_uri = "https://example.invalid/login_finished?username=new_user&password=secret"
    login_result = await bridge.pass_login_credentials(login_end_uri, {"end_uri": login_end_uri})
    assert login_result["status"] == "need_2fa"
    assert login_result["method"] == "email"

    email_end_uri = "https://example.invalid/two_factor_mail_finished?code=654321"
    final_result = await bridge.pass_login_credentials(email_end_uri, {"end_uri": email_end_uri})
    assert final_result["status"] == "authenticated"
    assert final_result["steamId"] == "76561198000000020"
    assert final_result["personaName"] == "New Account"

    assert all(call[0] not in {"rsa", "password", "update", "poll", "token"} for call in old_protocol_client.calls)
    assert [call[0] for call in new_protocol_client.calls if call[0] != "run"] == [
        "rsa",
        "password",
        "update",
        "poll",
        "token",
    ]

    await bridge.logout()
