
from .cache_proto import ProtoCache
import logging
import asyncio

logger = logging.getLogger(__name__)


class StatsCache(ProtoCache):
    def __init__(self):
        super(StatsCache, self).__init__()
        self._games_to_import = []
        self._achievement_metadata = {}
        self._metadata_event = asyncio.Event()
        self._metadata_expected = 0
        self._metadata_received = 0

    def expect_metadata(self, count: int):
        self._metadata_expected = count
        self._metadata_received = 0
        self._metadata_event.clear()

    async def wait_metadata_ready(self, timeout: float = 30):
        if self._metadata_expected == 0:
            return
        try:
            await asyncio.wait_for(self._metadata_event.wait(), timeout)
        except asyncio.TimeoutError:
            logger.warning("Timed out waiting for achievement metadata")

    def force_clear_stuck_import(self):
        """If Steam disconnects mid-import, unblock wait_ready/wait_metadata so the bridge can serve the next request."""
        if self._games_to_import:
            logger.warning("Forcing stats import end (stuck games): %s", self._games_to_import)
        self._games_to_import = []
        if self._metadata_expected and self._metadata_received < self._metadata_expected:
            self._metadata_received = self._metadata_expected
            self._metadata_event.set()
        self._update_ready_state()

    def start_game_stats_import(self, game_ids):
        # Normalize to a de-duplicated list of strings to avoid type mismatch
        unique_ids = list(dict.fromkeys([str(gid) for gid in (game_ids or [])]))
        for game_id in unique_ids:
            self._info_map[game_id] = dict()
        self._games_to_import = unique_ids
        self._achievement_metadata = {}  # Reset so get_total_achievement_count() reflects this fetch only
        self._update_ready_state()

    def get_total_achievement_count(self):
        n = len(self._achievement_metadata)
        return n if n > 0 else None

    @property
    def import_in_progress(self):
        self._update_ready_state()
        return not self._ready_event.is_set()

    def __iter__(self):
        yield from self._info_map.items()

    def _check_remove(self, game_id):
        gid = str(game_id)
        if gid in self._info_map and 'stats' in self._info_map[gid] \
                and 'achievements' in self._info_map[gid]:
            # Steam callbacks can arrive more than once for the same app.
            # Guard against ValueError on duplicate completion events.
            if gid in self._games_to_import:
                self._games_to_import.remove(gid)

    def _update_ready_state(self):
        if len(self._games_to_import) == 0:
            if self._ready_event.is_set():
                return
            logger.info("Setting state to ready")
            self._ready_event.set()
        else:
            self._ready_event.clear()

    def update_stats(self, game_id, stats, achievements):
        gid = str(game_id)
        if gid not in self._info_map:
            self._info_map[gid] = dict()
        self._info_map[gid]['stats'] = stats
        self._info_map[gid]['achievements'] = achievements

        self._check_remove(gid)
        self._update_ready_state()

    def update_achievement_metadata(self, achievements):
        for ach in achievements:
            name = ach.get('internal_name')
            if name:
                self._achievement_metadata[name] = ach
        
        self.increment_metadata_received()

    def increment_metadata_received(self):
        self._metadata_received += 1
        if self._metadata_received >= self._metadata_expected:
            self._metadata_event.set()

    def get_achievement_metadata(self, internal_name):
        return self._achievement_metadata.get(internal_name)
