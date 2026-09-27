import asyncio
import os
import sys
from types import SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, "..", "src"))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from steam_network.games_cache import GamesCache
from steam_network.protocol.protobuf_client import SteamLicense


def license(package_id, shared=False):
    return SteamLicense(SimpleNamespace(package_id=package_id), shared)


def test_package_cannot_finish_before_dependent_apps_are_registered():
    cache = GamesCache()
    cache.start_packages_import([license(10)])

    cache.update_license_apps("10", "100")
    cache.update_packages("10")

    status = cache.collection_status()
    assert status["completedPackages"] == 1
    assert status["pendingApps"] == 1
    assert status["complete"] is False
    assert cache.ready is False

    cache.update_app_title("100", "Game", "game", None)
    assert cache.collection_status()["complete"] is True
    assert cache.ready is True


def test_duplicate_and_overlapping_app_responses_are_idempotent():
    cache = GamesCache()
    cache.start_packages_import([license(10), license(20)])
    cache.update_license_apps("10", "100")
    cache.update_license_apps("20", "100")
    cache.update_packages("20")
    cache.update_packages("10")
    cache.update_app_title("100", "Shared", "game", None)
    cache.update_app_title("100", "Shared", "game", None)

    status = cache.collection_status()
    assert status["expectedApps"] == 1
    assert status["pendingApps"] == 0
    assert status["duplicateAppResponses"] == 1
    assert cache._parsing_status.apps_to_parse == 0
    assert status["complete"] is True


def test_out_of_order_app_response_does_not_make_counter_negative():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_app_title("100", "Early", "game", None)
    cache.update_license_apps("10", "100")
    cache.update_packages("10")

    assert cache._parsing_status.apps_to_parse == 0
    assert cache.collection_status()["complete"] is True


@pytest.mark.asyncio
async def test_missing_app_times_out_with_explicit_incomplete_status():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps("10", "100")
    cache.update_packages("10")

    with pytest.raises(asyncio.TimeoutError):
        await cache.wait_collection_terminal(0.01)

    status = cache.collection_status()
    assert status["complete"] is False
    assert status["reasons"] == ["missing_app_responses"]


@pytest.mark.parametrize("size", [0, 1, 500, 1500, 5000])
def test_unique_app_collection_scales_and_distinguishes_packages(size):
    cache = GamesCache()
    cache.start_packages_import([license(1), license(2)])
    for app_id in range(size):
        cache.update_license_apps("1", str(app_id))
        cache.update_license_apps("2", str(app_id))
    cache.update_packages("1")
    cache.update_packages("2")
    for app_id in range(size):
        cache.update_app_title(str(app_id), f"Game {app_id}", "game", None)

    status = cache.collection_status()
    assert status["expectedPackages"] == 2
    assert status["expectedApps"] == size
    assert status["complete"] is True

