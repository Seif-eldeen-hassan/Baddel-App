import asyncio
import os
import sys
from types import MethodType, SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, '..', 'src'))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from steam_network.enums import UserActionRequired
from steam_network.websocket_client import WebSocketClient


class ReconnectingProtocol:
    def __init__(self):
        self.finalize_calls = []

    async def run(self):
        return None

    async def finalize_login(self, username, steam_id, refresh_token, auth_lost_handler):
        self.finalize_calls.append((username, steam_id, refresh_token, auth_lost_handler))
        return UserActionRequired.NoActionRequired


@pytest.mark.asyncio
async def test_reconnect_reauthenticates_existing_session_before_resuming_requests():
    client = object.__new__(WebSocketClient)
    protocol = ReconnectingProtocol()
    client._connection_generation = 1
    client._automatic_reauth_count = 0
    client._protocol_client = protocol
    client._user_info_cache = SimpleNamespace(
        is_initialized=lambda: True,
        account_username='account',
        steam_id=123,
        refresh_token='token',
    )
    client._active_protocol_task = None
    client._active_auth_task = None
    client._active_auth_lost_future = None

    async def ensure_connected(self):
        return None

    async def all_auth_calls(self, auth_lost):
        return None

    async def no_op(self, *args):
        return None

    client._ensure_connected = MethodType(ensure_connected, client)
    client._all_auth_calls = MethodType(all_auth_calls, client)
    client._clear_active_run_state = MethodType(no_op, client)
    client._close_socket = MethodType(no_op, client)
    client._close_protocol_client = MethodType(no_op, client)

    await client.run()

    assert len(protocol.finalize_calls) == 1
    assert protocol.finalize_calls[0][:3] == ('account', 123, 'token')
    assert client._automatic_reauth_count == 1
