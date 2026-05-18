from dataclasses import dataclass, field
from dataclasses_json import dataclass_json
from typing import List, Dict, Optional, Set, AsyncGenerator, Callable, Union
import logging
import json
import copy
import asyncio

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
        self._ready_event.clear()
        logger.info("GamesCache fully reset")

    def reset_storing_map(self):
        self.reset()

    def start_packages_import(self, steam_licenses: List[SteamLicense]):
        package_ids = self.get_package_ids()
        self._parsing_status.packages_to_parse = 0
        # Fix: was passing the set object itself instead of its length
        logger.debug('Licenses to parse: %d, cached package_ids: %d', len(steam_licenses), len(package_ids))
        for steam_license in steam_licenses:
            if steam_license.license.package_id in package_ids:
                continue
            self._storing_map.licenses.append(License(package_id=str(steam_license.license.package_id),
                                             shared=steam_license.shared))
            self._parsing_status.packages_to_parse += 1
        self._parsing_status.apps_to_parse = 0
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

    def update_packages(self):
        self._parsing_status.packages_to_parse -= 1
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
        self._parsing_status.apps_to_parse += 1
        for license in self._storing_map.licenses:
            if license.package_id == package_id:
                license.app_ids.add(appid)

    def update_app_title(self, appid, title, type, parent):
        for license in self._storing_map.licenses:
            if appid in license.app_ids:
                self._parsing_status.apps_to_parse -= 1
        new_app = App(appid=appid, title=title, type=type, parent=parent)
        self._storing_map.apps[appid] = new_app
        if self.add_game_lever and new_app not in self._sent_apps:
            self._apps_added.append(new_app)

        self._update_ready_state()

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
