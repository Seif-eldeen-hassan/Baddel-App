from dataclasses import dataclass, field
from dataclasses_json import dataclass_json
from typing import List, Dict, Optional, Set, AsyncGenerator, Callable, Union
import logging
import json
import copy
import asyncio
import time

from .cache_proto import ProtoCache
from .protocol.protobuf_client import SteamLicense
from .w3_hack import WITCHER_3_DLCS_APP_IDS


logger = logging.getLogger(__name__)

# Steam apps are not always returned as "game".
# Examples like Wallpaper Engine / Lossless Scaling are usually Steam "application"
# apps, so the owned-library sync should include them as normal owned items.
OWNED_SYNC_APP_TYPES: Set[str] = {"game", "application"}


def normalize_app_type(app_type: Optional[str]) -> str:
    return str(app_type or "").strip().lower()


def is_owned_sync_app_type(app_type: Optional[str]) -> bool:
    return normalize_app_type(app_type) in OWNED_SYNC_APP_TYPES


@dataclass_json
@dataclass
class App:
    appid: str
    title: str
    type: str
    parent: Optional[str]


@dataclass_json
@dataclass
class License:
    package_id: str
    shared: bool
    app_ids: Set[str] = field(default_factory=set)


@dataclass_json
@dataclass
class LicensesCache:
    licenses: List[License] = field(default_factory=list)
    apps: Dict[str, App] = field(default_factory=dict)


@dataclass
class ParsingStatus:
    packages_to_parse: Optional[int] = None
    apps_to_parse: Optional[int] = None


class GamesCache(ProtoCache):

    _VERSION = "1.0.0"

    def __init__(self):
        super(GamesCache, self).__init__()
        self._storing_map: LicensesCache = LicensesCache()

        self._sent_apps = []

        self._apps_added: List[App] = []
        self.add_game_lever: bool = False

        self._parsing_status = ParsingStatus()
        self._collection_generation = 0
        self._expected_package_ids: Set[str] = set()
        self._completed_package_ids: Set[str] = set()
        self._expected_app_ids: Set[str] = set()
        self._pending_app_ids: Set[str] = set()
        self._completed_app_ids: Set[str] = set()
        self._failed_package_ids: Set[str] = set()
        self._failed_app_ids: Set[str] = set()
        self._duplicate_package_responses = 0
        self._duplicate_app_responses = 0
        self._requested_package_ids: Set[str] = set()
        self._requested_app_ids: Set[str] = set()
        self._package_retry_counts: Dict[str, int] = {}
        self._app_retry_counts: Dict[str, int] = {}
        self._unavailable_app_reasons: Dict[str, str] = {}
        self._license_discovery_complete = False
        self._progress_revision = 0
        self._collection_started_at = time.time()
        self._last_meaningful_progress_at = self._collection_started_at
        self._last_progress_kind = 'initialized'
        self._last_progress_id: Optional[str] = None

        # Optional async callback — called once when cache becomes ready.
        # Set by BaddelSteamBridge to push a "cache_ready" event to Electron.
        self.on_ready_callback: Optional[Callable] = None

    @property
    def version(self):
        return self._VERSION

    def reset(self):
        """Full reset of the cache state — called on logout/session switch."""
        self._storing_map = LicensesCache()
        self._sent_apps = []
        self._apps_added = []
        self.add_game_lever = False
        self._parsing_status = ParsingStatus()
        self._parsing_status.packages_to_parse = None
        self._parsing_status.apps_to_parse = None
        self._collection_generation += 1
        self._expected_package_ids.clear()
        self._completed_package_ids.clear()
        self._expected_app_ids.clear()
        self._pending_app_ids.clear()
        self._completed_app_ids.clear()
        self._failed_package_ids.clear()
        self._failed_app_ids = {
            app_id for app_id, app in self._storing_map.apps.items()
            if normalize_app_type(app.type) == 'unknown'
        }
        self._duplicate_package_responses = 0
        self._duplicate_app_responses = 0
        self._requested_package_ids.clear()
        self._requested_app_ids.clear()
        self._package_retry_counts.clear()
        self._app_retry_counts.clear()
        self._unavailable_app_reasons.clear()
        self._license_discovery_complete = False
        self._collection_started_at = time.time()
        self._mark_progress('reset')
        self._ready_event.clear()
        logger.info("GamesCache fully reset")

    def reset_storing_map(self):
        self.reset()

    def start_packages_import(self, steam_licenses: List[SteamLicense]):
        package_ids = self.get_package_ids()
        self._collection_generation += 1
        self._expected_package_ids.clear()
        self._completed_package_ids.clear()
        self._expected_app_ids.clear()
        self._pending_app_ids.clear()
        self._completed_app_ids = set(self._storing_map.apps.keys())
        self._failed_package_ids.clear()
        self._failed_app_ids = {
            app_id for app_id, app in self._storing_map.apps.items()
            if normalize_app_type(app.type) == 'unknown'
        }
        self._duplicate_package_responses = 0
        self._duplicate_app_responses = 0
        self._requested_package_ids = {str(item.license.package_id) for item in steam_licenses}
        self._requested_app_ids.clear()
        self._package_retry_counts.clear()
        self._app_retry_counts.clear()
        self._unavailable_app_reasons = {
            app_id: 'provider_public_only'
            for app_id, app in self._storing_map.apps.items()
            if normalize_app_type(app.type) == 'unavailable'
        }
        self._license_discovery_complete = True
        self._collection_started_at = time.time()
        self._mark_progress('license_discovery', str(len(steam_licenses)))
        # Fix: was passing the set object itself instead of its length
        logger.debug('Licenses to parse: %d, cached package_ids: %d', len(steam_licenses), len(package_ids))
        for steam_license in steam_licenses:
            package_key = str(steam_license.license.package_id)
            self._expected_package_ids.add(package_key)
            if package_key in package_ids:
                continue
            self._storing_map.licenses.append(License(package_id=package_key,
                                             shared=steam_license.shared))
        self._sync_legacy_counters()
        self._update_ready_state()

    def consume_added_games(self):
        apps = self._apps_added
        self._apps_added = []
        games = []
        for app in apps:
            if is_owned_sync_app_type(app.type):
                self._sent_apps.append(app)
                games.append(app)
        return games

    def get_package_ids(self) -> Set[str]:
        if not self._storing_map:
            return set()
        return set([license.package_id for license in copy.copy(self._storing_map).licenses])

    def get_resolved_packages(self) -> Set[str]:
        if not self._storing_map:
            return set()
        packages = set()
        storing_map = copy.copy(self._storing_map)
        for license in storing_map.licenses:
            if license.app_ids:
                resolved = True
                for app in license.app_ids:
                    if app not in storing_map.apps:
                        resolved = False
                if resolved:
                    packages.add(license.package_id)
        return packages

    def update_packages(self, package_id=None):
        package_key = str(package_id) if package_id is not None else None
        if package_key:
            if package_key in self._completed_package_ids:
                self._duplicate_package_responses += 1
            elif package_key in self._expected_package_ids:
                self._completed_package_ids.add(package_key)
                self._failed_package_ids.discard(package_key)
                self._mark_progress('package_received', package_key)
        else:
            unresolved = self._expected_package_ids - self._completed_package_ids
            if unresolved:
                self._completed_package_ids.add(next(iter(unresolved)))
        self._sync_legacy_counters()
        self._update_ready_state()

    async def __consume_resolved_apps(self, shared_licenses: bool, apptypes: Union[str, Set[str]]):
        if isinstance(apptypes, str):
            allowed_app_types = {normalize_app_type(apptypes)}
        else:
            allowed_app_types = {normalize_app_type(apptype) for apptype in apptypes}

        storing_map = copy.copy(self._storing_map)
        for license in storing_map.licenses:
            await asyncio.sleep(0.0001)  # do not block event loop; waiting one frame (0) was not enough 78#issuecomment-687140437
            if license.shared != shared_licenses:
                continue
            for appid in license.app_ids:
                if appid not in self._storing_map.apps:
                    logger.warning("Tried to retrieve unresolved app: %s for license: %s!", appid, license.package_id)
                    continue
                app = self._storing_map.apps[appid]
                app_type = normalize_app_type(app.type)
                if app_type in allowed_app_types:
                    self._sent_apps.append(app)
                    yield app
                # Necessary for the Witcher 3 => Witcher 3 GOTY import hack
                elif "game" in allowed_app_types and app_type == 'dlc' and appid in WITCHER_3_DLCS_APP_IDS:
                    yield app

    async def get_owned_games(self) -> AsyncGenerator[App, None]:
        async for app in self.__consume_resolved_apps(False, OWNED_SYNC_APP_TYPES):
            yield app

    async def get_dlcs(self) -> AsyncGenerator[App, None]:
        async for app in self.__consume_resolved_apps(False, 'dlc'):
            yield app

    async def get_shared_games(self) -> AsyncGenerator[App, None]:
        async for app in self.__consume_resolved_apps(True, 'game'):
            yield app

    def update_license_apps(self, package_id, appid):
        package_key = str(package_id)
        app_key = str(appid)
        already_linked = False
        for license in self._storing_map.licenses:
            if license.package_id == package_key:
                already_linked = app_key in license.app_ids
                license.app_ids.add(app_key)
        was_expected = app_key in self._expected_app_ids
        self._expected_app_ids.add(app_key)
        self._requested_app_ids.add(app_key)
        if app_key not in self._storing_map.apps:
            self._pending_app_ids.add(app_key)
        if not was_expected:
            self._mark_progress('app_discovered', app_key)
        self._sync_legacy_counters()
        self._update_ready_state()

    def update_app_title(self, appid, title, type, parent):
        app_key = str(appid)
        first_response = app_key not in self._completed_app_ids
        if not first_response:
            self._duplicate_app_responses += 1
        self._completed_app_ids.add(app_key)
        self._pending_app_ids.discard(app_key)
        if normalize_app_type(type) == 'unknown':
            self._failed_app_ids.add(app_key)
            self._unavailable_app_reasons[app_key] = 'unrecognized_or_public_only_record'
        else:
            self._failed_app_ids.discard(app_key)
            self._unavailable_app_reasons.pop(app_key, None)
        if first_response:
            self._mark_progress('app_received', app_key)
        new_app = App(appid=app_key, title=title, type=type, parent=parent)
        self._storing_map.apps[app_key] = new_app
        if self.add_game_lever and new_app not in self._sent_apps:
            self._apps_added.append(new_app)

        self._sync_legacy_counters()
        self._update_ready_state()

    def update_app_unavailable(self, appid, reason):
        app_key = str(appid)
        first_response = app_key not in self._completed_app_ids
        if not first_response:
            self._duplicate_app_responses += 1
        self._completed_app_ids.add(app_key)
        self._pending_app_ids.discard(app_key)
        self._failed_app_ids.discard(app_key)
        self._unavailable_app_reasons[app_key] = str(reason)
        if first_response:
            self._mark_progress('app_unavailable', app_key)
        self._storing_map.apps[app_key] = App(
            appid=app_key,
            title='Unavailable Steam entitlement',
            type='unavailable',
            parent=None,
        )
        self._sync_legacy_counters()
        self._update_ready_state()

    def record_package_failure(self, package_id):
        package_key = str(package_id)
        first_failure = package_key not in self._completed_package_ids
        self._failed_package_ids.add(package_key)
        self._completed_package_ids.add(package_key)
        if first_failure:
            self._mark_progress('package_parse_failed', package_key)
        self._sync_legacy_counters()
        self._update_ready_state()

    def _mark_progress(self, kind: str, identifier: Optional[str] = None):
        self._progress_revision += 1
        self._last_meaningful_progress_at = time.time()
        self._last_progress_kind = kind
        self._last_progress_id = str(identifier) if identifier is not None else None

    def record_recovery_request(self, package_ids, app_ids):
        for package_id in package_ids:
            key = str(package_id)
            self._requested_package_ids.add(key)
            self._package_retry_counts[key] = self._package_retry_counts.get(key, 0) + 1
        for app_id in app_ids:
            key = str(app_id)
            self._requested_app_ids.add(key)
            self._app_retry_counts[key] = self._app_retry_counts.get(key, 0) + 1
        if package_ids or app_ids:
            self._ready_event.clear()

    def recovery_candidates(self):
        pending_packages = self._expected_package_ids - self._completed_package_ids
        retry_packages = pending_packages | self._failed_package_ids
        retry_apps = self._pending_app_ids | self._failed_app_ids
        return sorted(retry_packages), sorted(retry_apps)

    def collection_status(self):
        now = time.time()
        pending_packages = self._expected_package_ids - self._completed_package_ids
        received_apps = self._expected_app_ids & self._completed_app_ids
        resolved_apps = received_apps - self._failed_app_ids
        complete = self._parsing_status.packages_to_parse == 0 and self._parsing_status.apps_to_parse == 0 and not self._failed_package_ids and not self._failed_app_ids
        reasons = []
        if pending_packages: reasons.append('missing_package_responses')
        if self._pending_app_ids: reasons.append('missing_app_responses')
        if self._failed_package_ids: reasons.append('package_parse_failures')
        if self._failed_app_ids: reasons.append('unknown_app_records')
        return {
            'generation': self._collection_generation, 'terminal': self._ready_event.is_set(), 'complete': complete,
            'licenseDiscoveryComplete': self._license_discovery_complete,
            'expectedPackages': len(self._expected_package_ids), 'completedPackages': len(self._completed_package_ids), 'pendingPackages': len(pending_packages),
            'expectedApps': len(self._expected_app_ids), 'completedApps': len(self._expected_app_ids & self._completed_app_ids), 'pendingApps': len(self._pending_app_ids),
            'failedPackages': len(self._failed_package_ids), 'failedApps': len(self._failed_app_ids),
            'unavailableApps': len(self._unavailable_app_reasons),
            'requestedPackages': len(self._requested_package_ids), 'requestedApps': len(self._requested_app_ids),
            'receivedApps': len(received_apps), 'resolvedApps': len(resolved_apps),
            'duplicatePackageResponses': self._duplicate_package_responses, 'duplicateAppResponses': self._duplicate_app_responses,
            'expectedPackageIds': sorted(self._expected_package_ids), 'requestedPackageIds': sorted(self._requested_package_ids),
            'receivedPackageIds': sorted(self._completed_package_ids), 'pendingPackageIds': sorted(pending_packages),
            'failedPackageIds': sorted(self._failed_package_ids), 'expectedAppIds': sorted(self._expected_app_ids),
            'requestedAppIds': sorted(self._requested_app_ids), 'receivedAppIds': sorted(received_apps),
            'resolvedAppIds': sorted(resolved_apps), 'pendingAppIds': sorted(self._pending_app_ids),
            'failedAppIds': sorted(self._failed_app_ids),
            'unavailableAppIds': sorted(self._unavailable_app_reasons),
            'unavailableAppReasons': dict(self._unavailable_app_reasons),
            'packageRetryCounts': dict(self._package_retry_counts), 'appRetryCounts': dict(self._app_retry_counts),
            'progressRevision': self._progress_revision, 'collectionStartedAt': self._collection_started_at,
            'lastMeaningfulProgressAt': self._last_meaningful_progress_at,
            'lastMeaningfulProgressAgeMs': max(0, int((now - self._last_meaningful_progress_at) * 1000)),
            'lastProgressKind': self._last_progress_kind, 'lastProgressId': self._last_progress_id,
            'reasons': reasons,
        }

    async def wait_collection_terminal(self, timeout=None):
        await asyncio.wait_for(self._ready_event.wait(), timeout)
        return self.collection_status()

    def _sync_legacy_counters(self):
        self._parsing_status.packages_to_parse = len(self._expected_package_ids - self._completed_package_ids)
        self._parsing_status.apps_to_parse = len(self._pending_app_ids)

    def _update_ready_state(self):
        if self._parsing_status.packages_to_parse == 0 and self._parsing_status.apps_to_parse == 0:
            if self._ready_event.is_set():
                return
            logger.info("Setting state to ready")
            self._ready_event.set()
            # on_ready_callback is a plain sync function set by BaddelSteamBridge.
            # It internally uses call_soon_threadsafe so it's safe to call from
            # any thread (including asyncio_0 worker threads).
            if self.on_ready_callback:
                try:
                    self.on_ready_callback()
                except Exception as e:
                    logger.warning(f"Could not fire cache_ready callback: {e}")
        else:
            self._ready_event.clear()

    def dump(self):
        cache_json = {}
        cache_json['licenses'] = self._storing_map.to_json()
        cache_json['version'] = self.version
        return json.dumps(cache_json)

    def loads(self, persistent_cache):
        cache = json.loads(persistent_cache)

        if 'version' not in cache or cache['version'] != self.version:
            logging.error("New plugin version, refreshing cache")
            return

        self._storing_map = LicensesCache.from_json(cache['licenses'])
        logging.info(f"Loaded games from cache {self._storing_map}")
