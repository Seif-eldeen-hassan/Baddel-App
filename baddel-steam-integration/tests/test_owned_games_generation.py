import os
import sys
from types import MethodType, SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, '..', 'src'))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from baddel_bridge import BaddelSteamBridge


class EmptyGamesCache:
    add_game_lever = False

    def collection_status(self):
        return {
            'generation': 8,
            'terminal': True,
            'complete': True,
            'reasons': [],
        }

    async def get_owned_games(self):
        if False:
            yield None

    def dump(self):
        return {}


@pytest.mark.asyncio
async def test_owned_games_rejects_generation_change_without_waiting():
    bridge = object.__new__(BaddelSteamBridge)
    bridge._user_info_cache = SimpleNamespace(steam_id=123)
    bridge._games_cache = EmptyGamesCache()
    bridge._persistent_cache = {}
    bridge._owned_games_parsed = False

    result = await bridge.get_owned_games(expected_generation=7)

    assert result['status'] == 'partial'
    assert result['complete'] is False
    assert result['terminationReason'] == 'stale_generation'
    assert result['completeness']['reasons'] == ['stale_generation']
