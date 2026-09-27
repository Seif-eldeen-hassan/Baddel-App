import os
import sys
from types import SimpleNamespace

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, '..', 'src'))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from steam_network.games_cache import GamesCache
from steam_network.protocol.protobuf_client import SteamLicense
from steam_network.protocol_client import ProtocolClient


def license(package_id, shared=False):
    return SteamLicense(SimpleNamespace(package_id=package_id), shared)


class RecordingProtobufClient:
    def __init__(self):
        self.package_requests = []
        self.app_requests = []

    async def get_packages_info(self, licenses):
        self.package_requests.append([str(item.license.package_id) for item in licenses])

    async def get_apps_info(self, app_ids):
        self.app_requests.append([str(item) for item in app_ids])


def test_collection_status_exposes_pending_ids_and_meaningful_progress():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps('10', '100')
    cache.update_packages('10')

    status = cache.collection_status()
    assert status['licenseDiscoveryComplete'] is True
    assert status['requestedPackageIds'] == ['10']
    assert status['receivedPackageIds'] == ['10']
    assert status['pendingAppIds'] == ['100']
    assert status['lastProgressKind'] == 'package_received'


@pytest.mark.asyncio
async def test_missing_app_response_is_requested_again_without_discarding_completed_work():
    cache = GamesCache()
    package = license(10)
    cache.start_packages_import([package])
    cache.update_license_apps('10', '100')
    cache.update_packages('10')
    protobuf = RecordingProtobufClient()
    client = SimpleNamespace(
        _games_cache=cache,
        _latest_licenses_by_package_id={'10': package},
        _protobuf_client=protobuf,
    )

    result = await ProtocolClient.retry_game_collection(client, cache.collection_status()['generation'])

    assert result['status'] == 'requested'
    assert result['requestedPackageIds'] == []
    assert result['requestedAppIds'] == ['100']
    assert protobuf.package_requests == []
    assert protobuf.app_requests == [['100']]
    assert cache.collection_status()['receivedPackageIds'] == ['10']
    assert cache.collection_status()['appRetryCounts'] == {'100': 1}


@pytest.mark.asyncio
async def test_stale_generation_cannot_restart_old_collection_work():
    cache = GamesCache()
    package = license(10)
    cache.start_packages_import([package])
    protobuf = RecordingProtobufClient()
    client = SimpleNamespace(
        _games_cache=cache,
        _latest_licenses_by_package_id={'10': package},
        _protobuf_client=protobuf,
    )

    result = await ProtocolClient.retry_game_collection(client, cache.collection_status()['generation'] - 1)

    assert result['status'] == 'stale_generation'
    assert protobuf.package_requests == []
    assert protobuf.app_requests == []


def test_recovery_request_is_not_counted_as_provider_progress():
    cache = GamesCache()
    cache.start_packages_import([license(10)])
    cache.update_license_apps('10', '100')
    revision = cache.collection_status()['progressRevision']

    cache.record_recovery_request([], ['100'])

    assert cache.collection_status()['progressRevision'] == revision
