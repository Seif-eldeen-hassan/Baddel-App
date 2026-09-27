import os
import sys
from types import SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, "..", "src"))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from steam_network.games_cache import GamesCache
from steam_network.protocol import protobuf_client as protobuf_module
from steam_network.protocol.protobuf_client import ProtobufClient, SteamLicense


def license(package_id):
    return SteamLicense(SimpleNamespace(package_id=package_id), False)


async def parse_single_app(monkeypatch, app_content, appid):
    class ProductInfoResponse:
        def __init__(self):
            self.packages = []
            self.apps = [SimpleNamespace(buffer=b"ignored\0", appid=int(appid))]

        def ParseFromString(self, _body):
            return None

    monkeypatch.setattr(protobuf_module, "CMsgClientPICSProductInfoResponse", ProductInfoResponse)
    monkeypatch.setattr(protobuf_module.vdf, "loads", lambda _value: app_content)
    client = ProtobufClient(None)
    events = []
    client.app_info_handler = lambda **event: events.append(event)
    await client._process_product_info_response(b"")
    return events


@pytest.mark.asyncio
async def test_public_only_response_is_reported_as_provider_unavailable(monkeypatch):
    events = await parse_single_app(
        monkeypatch,
        {"appinfo": {"appid": "2943730", "public_only": "1"}},
        "2943730",
    )

    assert events == [{
        "appid": "2943730",
        "unavailable_reason": "provider_public_only",
    }]


@pytest.mark.asyncio
async def test_dlc_without_extended_parent_uses_common_parent(monkeypatch):
    events = await parse_single_app(
        monkeypatch,
        {
            "appinfo": {
                "appid": "2028850",
                "common": {
                    "name": "Bioshock Infinite: Columbia's Finest",
                    "type": "DLC",
                    "parent": "8870",
                },
                "extended": {"publisher": "2K"},
            }
        },
        "2028850",
    )

    assert events == [{
        "appid": "2028850",
        "title": "Bioshock Infinite: Columbia's Finest",
        "type": "dlc",
        "parent": "8870",
    }]


@pytest.mark.asyncio
async def test_provider_unavailable_records_are_terminal_but_not_owned_games():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "2943730")
    cache.update_packages("10")
    cache.update_app_unavailable("2943730", "provider_public_only")

    status = cache.collection_status()
    assert status["terminal"] is True
    assert status["complete"] is True
    assert status["failedApps"] == 0
    assert status["unavailableApps"] == 1
    assert status["unavailableAppIds"] == ["2943730"]
    assert status["unavailableAppReasons"] == {
        "2943730": "provider_public_only",
    }
    assert cache.recovery_candidates() == ([], [])
    assert [game async for game in cache.get_owned_games()] == []


def test_malformed_unknown_record_remains_failed_and_recoverable():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "999")
    cache.update_packages("10")
    cache.update_app_title("999", "unknown", "unknown", None)

    status = cache.collection_status()
    assert status["terminal"] is True
    assert status["complete"] is False
    assert status["failedAppIds"] == ["999"]
    assert cache.recovery_candidates() == ([], ["999"])


def test_public_only_classification_survives_collection_reconnect():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "2943730")
    cache.update_packages("10")
    cache.update_app_unavailable("2943730", "provider_public_only")

    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "2943730")
    cache.update_packages("10")

    status = cache.collection_status()
    assert status["complete"] is True
    assert status["unavailableAppIds"] == ["2943730"]
    assert cache.recovery_candidates() == ([], [])


def test_unknown_failure_survives_collection_reconnect():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "999")
    cache.update_packages("10")
    cache.update_app_title("999", "unknown", "unknown", None)

    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "999")
    cache.update_packages("10")

    status = cache.collection_status()
    assert status["complete"] is False
    assert status["failedAppIds"] == ["999"]
    assert cache.recovery_candidates() == ([], ["999"])
