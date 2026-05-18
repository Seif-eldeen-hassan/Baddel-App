"""
baddel_bridge.py
================
Baddel Launcher — Steam Integration Bridge

Replaces GOG Galaxy's plugin.py entirely.
Communicates with Electron (Node.js) via JSON-RPC over stdin/stdout.

Protocol:
  Node → Python:  { "id": 1, "method": "authenticate", "params": {...} }
  Python → Node:  { "id": 1, "result": {...} }   (success)
                  { "id": 1, "error": "message" } (failure)

  Python can also push unsolicited events:
                  { "event": "games_update", "data": [...] }
                  { "event": "cache_ready",  "data": {"status": "ready"} }
                  { "event": "auth_step",    "data": {...} }
"""

import sys
import os as _os

# ── Early-exit CLI args (--version / --self-test) ─────────────────────────────
# Must run before heavy imports so PyInstaller exe responds instantly.
if len(sys.argv) > 1 and sys.argv[1] in ('--version', '--self-test'):
    _src_dir = _os.path.dirname(_os.path.abspath(__file__))
    if _src_dir not in sys.path:
        sys.path.insert(0, _src_dir)
    _arg = sys.argv[1]
    if _arg == '--version':
        from version import __version__ as _bridge_version
        print(f"baddel_bridge {_bridge_version}")
        sys.exit(0)
    elif _arg == '--self-test':
        try:
            import certifi, aiohttp, websockets, rsa, cryptography
            import dataclasses_json, vdf, google.protobuf
            from steam_network.websocket_client import WebSocketClient
            print("BRIDGE_OK")
            sys.exit(0)
        except Exception as _e:
            print(f"BRIDGE_FAIL: {_e}")
            sys.exit(1)

if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import asyncio
import json
import logging
import ssl
import sys
import os
from typing import Optional, Dict, Any
from contextlib import suppress

import certifi

# ── Paths ─────────────────────────────────────────────────────────────────────
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SRC_DIR)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="[STEAM-BRIDGE] %(levelname)s %(name)s: %(message)s",
    stream=sys.stderr,   # stderr → not mixed with JSON on stdout
)
logger = logging.getLogger("baddel_bridge")

_quiet_logs       = os.environ.get("BADDEL_QUIET_LOGS")       == "1"
_steam_auth_debug = os.environ.get("BADDEL_STEAM_AUTH_DEBUG") == "1"

if _quiet_logs:
    logging.getLogger("steam_network.protocol.protobuf_client").setLevel(logging.WARNING)
    logging.getLogger("steam_network.protocol_client").setLevel(logging.WARNING)
    logging.getLogger("steam_network.games_cache").setLevel(logging.WARNING)
    logging.getLogger("steam_network.stats_cache").setLevel(logging.WARNING)
    logging.getLogger("steam_network.websocket_client").setLevel(logging.WARNING)
    logging.getLogger("steam_network.websocket_list").setLevel(logging.WARNING)
    logging.getLogger("steam_network.friends_cache").setLevel(logging.WARNING)

if _steam_auth_debug:
    logging.getLogger("baddel_bridge").setLevel(logging.DEBUG)
    logging.getLogger("steam_network.protocol_client").setLevel(logging.INFO)
    logging.getLogger("steam_network.websocket_client").setLevel(logging.INFO)

# ── Internal imports (unchanged steam_network code) ───────────────────────────
from persistent_cache_state import PersistentCacheState
from steam_network.websocket_client import WebSocketClient
from steam_network.websocket_list import WebSocketList
from steam_network.steam_http_client import SteamHttpClient
from steam_network.friends_cache import FriendsCache
from steam_network.games_cache import GamesCache
from steam_network.stats_cache import StatsCache
from steam_network.times_cache import TimesCache
from steam_network.user_info_cache import UserInfoCache
from steam_network.authentication_cache import AuthenticationCache
from steam_network.local_machine_cache import LocalMachineCache
from steam_network.secure_credential_storage import SecureCredentialStorage
from steam_network.enums import (
    UserActionRequired, AuthCall, DisplayUriHelper, TwoFactorMethod
)
from steam_network.presence import presence_from_user_info
from steam_network.protocol.steam_types import ProtoUserInfo

# ── Replacements for galaxy.api types (simple dicts instead) ─────────────────
# We don't use GOG SDK at all — everything is plain Python dicts/JSON.

GAME_CACHE_IS_READY_TIMEOUT = 50
GAME_DOES_NOT_SUPPORT_LAST_PLAYED_VALUE = 86400

AVATAR_URL_TEMPLATE = "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/{}/{}_full.jpg"
NO_AVATAR_SET = "0000000000000000000000000000000000000000"
DEFAULT_AVATAR_HASH = "fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb"

def avatar_url_from_hash(a_hash: str) -> str:
    if a_hash == NO_AVATAR_SET:
        a_hash = DEFAULT_AVATAR_HASH
    return AVATAR_URL_TEMPLATE.format(a_hash[:2], a_hash)


def _requested_steam_id_from_stored(stored_credentials: Optional[Dict]) -> str:
    """
    Electron may pass either { "steam_id": "<id>" } (plain) or the encrypted
    blob from user_info_cache.to_dict(). The encrypted form stores base64
    ciphertext under "steam_id", so a naive string compare in authenticate()
    never matches the live session and forces a failing token re-login.

    Also accepts steamAccountId — plain decimal id added for Electron keying (see tick()).
    """
    if not stored_credentials:
        return ""
    plain = stored_credentials.get("steamAccountId") or stored_credentials.get("steam_id_plain")
    if plain:
        return str(plain).strip()
    try:
        decrypted = SecureCredentialStorage.decrypt_credentials(dict(stored_credentials))
        sid = (decrypted or {}).get("steam_id") or ""
        if sid:
            return str(sid).strip()
    except Exception:
        pass
    sid = stored_credentials.get("steam_id") or stored_credentials.get("steamId") or ""
    return str(sid).strip()


def _steam_ids_equal(a: str, b: str) -> bool:
    try:
        return int(a) == int(b)
    except (ValueError, TypeError):
        return str(a) == str(b)


# ═════════════════════════════════════════════════════════════════════════════
# BaddelSteamBridge — Core logic
# ═════════════════════════════════════════════════════════════════════════════

class BaddelSteamBridge:
    def __init__(self, push_event_fn):
        """
        push_event_fn: async callable(event_name: str, data: Any)
            Used to push unsolicited events to Electron (e.g. new games found).
        """
        self._push_event = push_event_fn

        # ── SSL ───────────────────────────────────────────────────────────────
        self._ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self._ssl_context.load_verify_locations(certifi.where())

        # ── Caches ────────────────────────────────────────────────────────────
        self._persistent_storage_state = PersistentCacheState()
        self._persistent_cache: Dict[str, Any] = {}
        self._credentials: Dict[str, Any] = {}   # stored by Electron, passed back on restart

        self._authentication_cache = AuthenticationCache()
        self._user_info_cache = UserInfoCache()
        self._games_cache = GamesCache()
        self._stats_cache = StatsCache()
        self._achievement_schema_cache = {}
        self._times_cache = TimesCache()
        self._friends_cache = FriendsCache()
        self._translations_cache: Dict[int, str] = {}

        # Wire the cache_ready callback so Electron knows exactly when PICS
        # has finished and games are available — no polling needed.
        #
        # _update_ready_state() is called from a worker thread (asyncio_0),
        # so we cannot use ensure_future() or create_task() directly.
        # Instead we capture the running loop here (on the main async thread)
        # and use call_soon_threadsafe() to safely schedule the coroutine
        # from whatever thread fires the callback.
        _main_loop = asyncio.get_event_loop()

        async def _on_games_cache_ready():
            logger.info("Games cache is ready — pushing cache_ready event to Electron")
            steam_id = str(self._user_info_cache.steam_id) if self._user_info_cache.steam_id else None
            await self._push_event("cache_ready", {"status": "ready", "steamAccountId": steam_id})

        def _on_games_cache_ready_threadsafe():
            _main_loop.call_soon_threadsafe(
                lambda: _main_loop.create_task(_on_games_cache_ready())
            )

        self._games_cache.on_ready_callback = _on_games_cache_ready_threadsafe

        # ── Presence handler: push to Electron ────────────────────────────────
        async def _presence_handler(user_id: str, proto_user_info: ProtoUserInfo):
            presence = await presence_from_user_info(proto_user_info, self._translations_cache)
            await self._push_event("presence_update", {
                "userId": user_id,
                "status": presence.presence_state.value if presence.presence_state else None,
                "gameId": presence.game_id,
                "gameTitle": presence.game_title,
                "fullStatus": presence.full_status,
            })

        self._friends_cache.updated_handler = _presence_handler

        # ── HTTP client (aiohttp session) ─────────────────────────────────────
        import aiohttp
        self._aiohttp_session: Optional[aiohttp.ClientSession] = None

        local_machine_cache = LocalMachineCache(self._persistent_cache, self._persistent_storage_state)

        # SteamHttpClient wraps aiohttp — we create it after session is ready
        self._local_machine_cache = local_machine_cache
        self._websocket_client: Optional[WebSocketClient] = None

        # Background tasks
        self._steam_run_task: Optional[asyncio.Task] = None
        self._update_games_task: asyncio.Task = asyncio.create_task(asyncio.sleep(0))
        self._owned_games_parsed = False

    # ── Session setup ─────────────────────────────────────────────────────────

    async def start(self):
        """Called once on startup to init the aiohttp session."""
        import aiohttp
        self._aiohttp_session = aiohttp.ClientSession()
        steam_http = _AiohttpSteamHttpClient(self._aiohttp_session)
        self._websocket_client = WebSocketClient(
            WebSocketList(steam_http),
            self._ssl_context,
            self._friends_cache,
            self._games_cache,
            self._translations_cache,
            self._stats_cache,
            self._times_cache,
            self._authentication_cache,
            self._user_info_cache,
            self._local_machine_cache,
        )
        logger.info("BaddelSteamBridge started")

    async def shutdown(self):
        if self._websocket_client:
            await self._websocket_client.close()
            await self._websocket_client.wait_closed()
        if self._aiohttp_session:
            await self._aiohttp_session.close()
        for task in [self._steam_run_task, self._update_games_task]:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("BaddelSteamBridge shut down")

    async def logout(self):
        """Clears current session and user data."""
        if self._steam_run_task and not self._steam_run_task.done():
            self._steam_run_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._steam_run_task
        self._steam_run_task = None

        if self._websocket_client:
            self._websocket_client.reset_auth_session()
            await self._websocket_client.close()
            await self._websocket_client.wait_closed()

        self._user_info_cache.Clear()
        self._friends_cache.reset([])
        self._games_cache.reset()  # Full reset including parsing status
        self._stats_cache._info_map = {}
        self._stats_cache._games_to_import = []
        self._times_cache._cache = {}
        self._owned_games_parsed = False
        
        # Clear the memory-resident persistent cache to avoid bleeding
        # games from the previous session into the next one.
        self._persistent_cache = {}
        
        logger.info("BaddelSteamBridge logged out and ALL caches (including persistent) cleared")

    # ── Tick (called periodically by event loop) ──────────────────────────────

    async def tick(self):
        """Push newly discovered games to Electron."""
        if self._update_games_task.done() and self._owned_games_parsed:
            self._update_games_task = asyncio.create_task(self._push_new_games())

        if self._user_info_cache.changed:
            creds = self._user_info_cache.to_dict()
            # Plain id for Electron — never use encrypted "steam_id" value as object key (JS).
            if self._user_info_cache.steam_id is not None:
                creds = {**creds, "steamAccountId": str(self._user_info_cache.steam_id)}
            await self._push_event("store_credentials", creds)
            self._user_info_cache._changed = False

    async def _push_new_games(self):
        new_games = self._games_cache.consume_added_games()
        if not new_games:
            return
        games_list = [{"id": f"steam_{g.appid}", "title": g.title, "appid": str(g.appid)} for g in new_games]
        steam_id = str(self._user_info_cache.steam_id) if self._user_info_cache.steam_id else None
        await self._push_event("games_update", {"steamAccountId": steam_id, "games": games_list})

    # ── Authentication ────────────────────────────────────────────────────────

    async def authenticate(self, stored_credentials: Optional[Dict] = None) -> Dict:
        """
        Returns either:
          { "status": "need_login", "loginUrl": "...", "endUriRegex": "..." }
          { "status": "authenticated", "steamId": "...", "personaName": "..." }
        """
        if "games" in self._persistent_cache:
            self._games_cache.loads(self._persistent_cache["games"])

        # 1. هل الاتصال شغال حالياً في الخلفية؟
        is_running = self._steam_run_task and not self._steam_run_task.done()

        # 2. التحقق من تغيير الحساب (Account Switching)
        if stored_credentials and is_running and self._user_info_cache.steam_id:
            req_id = _requested_steam_id_from_stored(stored_credentials)
            cur_id = str(self._user_info_cache.steam_id)
            
            if req_id and not _steam_ids_equal(req_id, cur_id):
                logger.info(f"Account switch detected: {cur_id} -> {req_id}. Performing hard reset.")
                await self.logout()
                is_running = False
            elif req_id and _steam_ids_equal(req_id, cur_id):
                logger.info(f"Already authenticated as {cur_id}. Skipping re-login.")
                # نبعت إشعار للـ JavaScript إن الداتا جاهزة عشان ميهنجش
                asyncio.create_task(self._push_event("cache_ready", {"status": "ready", "steamAccountId": cur_id}))
                return self._authenticated_response()

        # 3. لو مش شغال، ابدأ الاتصال
        if not is_running:
            self._steam_run_task = asyncio.create_task(self._websocket_client.run())

        # 4. لو في بيانات تسجيل دخول، ابعتها لـ Steam
        if stored_credentials:
            return await self._authenticate_with_token(stored_credentials)

        return self._choose_login_method_response()

    async def _authenticate_with_token(self, creds: Dict) -> Dict:
        self._user_info_cache.from_dict(creds)
        if self._user_info_cache.is_initialized():
            await self._websocket_client.communication_queues["websocket"].put(
                {"mode": AuthCall.TOKEN}
            )
            result = await self._get_auth_step()
            if result == UserActionRequired.NoActionRequired:
                return self._authenticated_response()
            else:
                logger.info(f"Token login failed ({result}), falling back to password login")
                self._user_info_cache.Clear()

        return self._need_login_response()

    def _need_login_response(self) -> Dict:
        uri = DisplayUriHelper.LOGIN
        return {
            "status": "need_login",
            "loginUrl": uri.GetStartUri(),
            "endUriRegex": uri.GetEndUriRegex(),
        }

    def _choose_login_method_response(self) -> Dict:
        """Returns the method-chooser status for fresh Steam linking."""
        login_uri = DisplayUriHelper.LOGIN
        return {
            "status": "choose_login_method",
            "methods": ["qr", "password"],
            "loginUrl": login_uri.GetStartUri(view="choose_method"),
            "passwordLoginUrl": login_uri.GetStartUri(),
            "endUriRegex": r".*login_finished.*|.*two_factor.*|baddel://auth/.*",
        }

    def _authenticated_response(self) -> Dict:
        # Must be string: Steam IDs exceed JS Number.MAX_SAFE_INTEGER — JSON numbers corrupt in Electron.
        sid = self._user_info_cache.steam_id
        return {
            "status": "authenticated",
            "steamId": str(sid) if sid is not None else "",
            "personaName": self._user_info_cache.persona_name or "",
        }

    async def pass_login_credentials(self, end_uri: str, credentials: Dict) -> Dict:
        """
        Called by Electron when the embedded login page redirects.
        Returns same shape as authenticate().
        """
        if DisplayUriHelper.LOGIN.EndUri() in end_uri:
            return await self._handle_login_finished(credentials)
        elif DisplayUriHelper.TWO_FACTOR_MAIL.EndUri() in end_uri:
            return await self._handle_steam_guard(credentials, TwoFactorMethod.EmailCode, DisplayUriHelper.TWO_FACTOR_MAIL)
        elif DisplayUriHelper.TWO_FACTOR_MOBILE.EndUri() in end_uri:
            return await self._handle_steam_guard(credentials, TwoFactorMethod.PhoneCode, DisplayUriHelper.TWO_FACTOR_MOBILE)
        elif DisplayUriHelper.TWO_FACTOR_CONFIRM.EndUri() in end_uri:
            return await self._handle_steam_guard_check(DisplayUriHelper.TWO_FACTOR_CONFIRM, True)
        else:
            return {"status": "error", "message": f"Unknown end_uri: {end_uri}"}

    async def _get_auth_step(self) -> UserActionRequired:
        try:
            result = await asyncio.wait_for(
                self._websocket_client.communication_queues["plugin"].get(), 60
            )
            return result["auth_result"]
        except asyncio.TimeoutError:
            return UserActionRequired.InvalidAuthData

    async def _get_auth_step_full(self) -> Dict:
        """Like _get_auth_step but returns the full plugin-queue dict (for QR challenge_url etc.)."""
        try:
            return await asyncio.wait_for(
                self._websocket_client.communication_queues["plugin"].get(), 60
            )
        except asyncio.TimeoutError:
            return {"auth_result": UserActionRequired.InvalidAuthData}

    # ── New direct API commands ────────────────────────────────────────────────

    async def start_qr_login(self) -> Dict:
        """Start a QR login session. Returns need_qr with challengeUrl and interval."""
        await self._websocket_client.communication_queues["websocket"].put(
            {"mode": AuthCall.QR_LOGIN}
        )
        full = await self._get_auth_step_full()
        if full.get("auth_result") == UserActionRequired.NoActionConfirmLogin and full.get("auth_mode") == "qr":
            return {
                "status": "need_qr",
                "challengeUrl": full.get("challenge_url", ""),
                "interval": full.get("interval", 2),
            }
        return {"status": "error", "message": "Failed to start QR session"}

    async def start_password_login(self, username: str, password: str) -> Dict:
        """Start a password-based login. Mirrors _handle_login_finished but takes args directly."""
        pwd = self._sanitize(password)
        await self._websocket_client.communication_queues["websocket"].put(
            {"mode": AuthCall.RSA_AND_LOGIN, "username": username, "password": pwd}
        )
        result = await self._get_auth_step()

        if result == UserActionRequired.NoActionConfirmLogin:
            return await self._handle_steam_guard_none()
        elif result == UserActionRequired.TwoFactorRequired:
            allowed = self._authentication_cache.two_factor_allowed_methods
            method, msg = allowed[0]
            if method == TwoFactorMethod.Nothing:
                return await self._handle_steam_guard_none()
            elif method == TwoFactorMethod.PhoneCode:
                return {"status": "need_2fa", "method": "mobile",
                        "loginUrl": DisplayUriHelper.TWO_FACTOR_MOBILE.GetStartUri(),
                        "endUriRegex": DisplayUriHelper.TWO_FACTOR_MOBILE.GetEndUriRegex()}
            elif method == TwoFactorMethod.EmailCode:
                return {"status": "need_2fa", "method": "email",
                        "loginUrl": DisplayUriHelper.TWO_FACTOR_MAIL.GetStartUri(),
                        "endUriRegex": DisplayUriHelper.TWO_FACTOR_MAIL.GetEndUriRegex()}
            elif method == TwoFactorMethod.PhoneConfirm:
                return {"status": "need_2fa", "method": "confirm",
                        "loginUrl": DisplayUriHelper.TWO_FACTOR_CONFIRM.GetStartUri(),
                        "endUriRegex": DisplayUriHelper.TWO_FACTOR_CONFIRM.GetEndUriRegex()}
        return {"status": "need_login",
                "loginUrl": DisplayUriHelper.LOGIN.GetStartUri(True),
                "endUriRegex": DisplayUriHelper.LOGIN.GetEndUriRegex()}

    async def submit_steam_guard_code(self, code: str, method: str) -> Dict:
        """Submit a Steam Guard email or mobile code."""
        tf_method = TwoFactorMethod.EmailCode if method == "email" else TwoFactorMethod.PhoneCode
        fallback = DisplayUriHelper.TWO_FACTOR_MAIL if method == "email" else DisplayUriHelper.TWO_FACTOR_MOBILE

        await self._websocket_client.communication_queues["websocket"].put(
            {"mode": AuthCall.UPDATE_TWO_FACTOR, "two-factor-code": code, "two-factor-method": tf_method}
        )
        result = await self._get_auth_step()

        if result == UserActionRequired.NoActionConfirmLogin:
            return await self._handle_steam_guard_check(fallback, False)
        elif result == UserActionRequired.TwoFactorExpired:
            return {"status": "need_login",
                    "loginUrl": DisplayUriHelper.LOGIN.GetStartUri(True, expired="true"),
                    "endUriRegex": DisplayUriHelper.LOGIN.GetEndUriRegex()}
        elif result == UserActionRequired.InvalidAuthData:
            return {"status": "need_2fa", "error": "invalid_code",
                    "loginUrl": fallback.GetStartUri(True),
                    "endUriRegex": fallback.GetEndUriRegex()}
        return {"status": "need_2fa",
                "loginUrl": fallback.GetStartUri(True),
                "endUriRegex": fallback.GetEndUriRegex()}

    async def poll_auth_status(self) -> Dict:
        """Poll for the current QR or device-confirmation session.
        Safe to call repeatedly; returns pending_approval while still waiting."""
        return await self._handle_steam_guard_check(DisplayUriHelper.TWO_FACTOR_CONFIRM, True)

    @staticmethod
    def _sanitize(s: str) -> str:
        return (''.join(c for c in s if ord(c) < 128))[:64]

    async def _handle_login_finished(self, credentials: Dict) -> Dict:
        from urllib import parse
        parsed = parse.urlsplit(credentials.get("end_uri", ""))
        params = parse.parse_qs(parsed.query)

        if "password" not in params or "username" not in params:
            return {"status": "need_login", "loginUrl": DisplayUriHelper.LOGIN.GetStartUri(True), "endUriRegex": DisplayUriHelper.LOGIN.GetEndUriRegex()}

        user = params["username"][0]
        pwd = self._sanitize(params["password"][0])

        await self._websocket_client.communication_queues["websocket"].put(
            {"mode": AuthCall.RSA_AND_LOGIN, "username": user, "password": pwd}
        )
        result = await self._get_auth_step()

        if result == UserActionRequired.NoActionConfirmLogin:
            return await self._handle_steam_guard_none()
        elif result == UserActionRequired.TwoFactorRequired:
            allowed = self._authentication_cache.two_factor_allowed_methods
            method, msg = allowed[0]
            if method == TwoFactorMethod.Nothing:
                return await self._handle_steam_guard_none()
            elif method == TwoFactorMethod.PhoneCode:
                return {"status": "need_2fa", "method": "mobile", "loginUrl": DisplayUriHelper.TWO_FACTOR_MOBILE.GetStartUri(), "endUriRegex": DisplayUriHelper.TWO_FACTOR_MOBILE.GetEndUriRegex()}
            elif method == TwoFactorMethod.EmailCode:
                return {"status": "need_2fa", "method": "email", "loginUrl": DisplayUriHelper.TWO_FACTOR_MAIL.GetStartUri(), "endUriRegex": DisplayUriHelper.TWO_FACTOR_MAIL.GetEndUriRegex()}
            elif method == TwoFactorMethod.PhoneConfirm:
                return {"status": "need_2fa", "method": "confirm", "loginUrl": DisplayUriHelper.TWO_FACTOR_CONFIRM.GetStartUri(), "endUriRegex": DisplayUriHelper.TWO_FACTOR_CONFIRM.GetEndUriRegex()}
        return {"status": "need_login", "loginUrl": DisplayUriHelper.LOGIN.GetStartUri(True), "endUriRegex": DisplayUriHelper.LOGIN.GetEndUriRegex()}

    async def _handle_steam_guard(self, credentials: Dict, method: TwoFactorMethod, fallback: DisplayUriHelper) -> Dict:
        from urllib import parse
        parsed = parse.urlsplit(credentials.get("end_uri", ""))
        params = parse.parse_qs(parsed.query)

        if "code" not in params:
            return {"status": "need_2fa", "loginUrl": fallback.GetStartUri(True), "endUriRegex": fallback.GetEndUriRegex()}

        code = params["code"][0].strip()
        await self._websocket_client.communication_queues["websocket"].put(
            {"mode": AuthCall.UPDATE_TWO_FACTOR, "two-factor-code": code, "two-factor-method": method}
        )
        result = await self._get_auth_step()

        if result == UserActionRequired.NoActionConfirmLogin:
            return await self._handle_steam_guard_check(fallback, False)
        elif result == UserActionRequired.TwoFactorExpired:
            return {"status": "need_login", "loginUrl": DisplayUriHelper.LOGIN.GetStartUri(True, expired="true"), "endUriRegex": DisplayUriHelper.LOGIN.GetEndUriRegex()}
        return {"status": "need_2fa", "loginUrl": fallback.GetStartUri(True), "endUriRegex": fallback.GetEndUriRegex()}

    async def _handle_steam_guard_none(self) -> Dict:
        result = await self._poll_2fa()
        if result == UserActionRequired.NoActionRequired:
            return self._authenticated_response()
        elif result == UserActionRequired.NoActionConfirmToken:
            return await self._finish_auth()
        return {"status": "error", "message": "Unexpected auth state"}

    async def _handle_steam_guard_check(self, fallback: DisplayUriHelper, is_confirm: bool) -> Dict:
        try:
            result = await self._poll_2fa(is_confirm)
        except Exception as e:
            if is_confirm:
                return {"status": "approval_denied", "message": str(e)}
            return {"status": "error", "message": str(e)}

        if result == UserActionRequired.NoActionRequired:
            return self._authenticated_response()
        elif result == UserActionRequired.NoActionConfirmToken:
            return await self._finish_auth()
        elif result in (UserActionRequired.NoActionConfirmLogin, UserActionRequired.TwoFactorRequired):
            if is_confirm:
                return {"status": "pending_approval"}
            return {"status": "need_2fa", "loginUrl": fallback.GetStartUri(True), "endUriRegex": fallback.GetEndUriRegex()}
        elif result == UserActionRequired.TwoFactorExpired:
            if is_confirm:
                return {"status": "approval_expired"}
            return {"status": "need_login", "loginUrl": DisplayUriHelper.LOGIN.GetStartUri(True, expired="true"), "endUriRegex": DisplayUriHelper.LOGIN.GetEndUriRegex()}
        elif result == UserActionRequired.InvalidAuthData:
            if is_confirm:
                return {"status": "approval_denied", "message": "Auth poll timed out or failed"}
            return {"status": "error", "message": "Auth poll timed out"}
        return {"status": "error", "message": "Unexpected auth state"}

    async def _poll_2fa(self, is_confirm: bool = False) -> UserActionRequired:
        await self._websocket_client.communication_queues["websocket"].put(
            {"mode": AuthCall.POLL_TWO_FACTOR, "is-confirm": is_confirm}
        )
        return await self._get_auth_step()

    async def _finish_auth(self) -> Dict:
        # QR auth returns account_name + refresh/access token before we know steam_id.
        # The following TOKEN login is what returns the real steam_id via ClientLogonResponse.
        if self._user_info_cache.account_username and self._user_info_cache.refresh_token:
            if self._user_info_cache.steam_id is None:
                logger.warning(
                    "QR/token auth has username+token but no steam_id yet; using temporary steam_id=0 until TOKEN login returns the real id."
                )
                self._user_info_cache.steam_id = 0

            await self._websocket_client.communication_queues["websocket"].put({"mode": AuthCall.TOKEN})
            result = await self._get_auth_step()

            if result == UserActionRequired.NoActionRequired:
                return self._authenticated_response()

        logger.error(
            "Auth failed in _finish_auth. Cache state: username=%s, sid=%s, has_token=%s",
            self._user_info_cache.account_username,
            self._user_info_cache.steam_id,
            bool(self._user_info_cache.refresh_token),
        )
        return {"status": "error", "message": "Auth failed"}

    # ── Owned Games ───────────────────────────────────────────────────────────

    async def get_owned_games(self) -> Dict:
        """Returns full owned games list after cache is ready."""
        if not self._user_info_cache.steam_id:
            return {"status": "error", "message": "Not authenticated"}

        await self._games_cache.wait_ready(GAME_CACHE_IS_READY_TIMEOUT)
        self._games_cache.add_game_lever = True

        games = []
        async for app in self._games_cache.get_owned_games():
            games.append({
                "id": f"steam_{app.appid}",
                "title": app.title,
                "appid": str(app.appid),
                "platform": "steam",
                "steamAppType": app.type,
            })
        self._owned_games_parsed = True
        self._persistent_cache["games"] = self._games_cache.dump()

        return {"status": "success", "games": games}

    # ── Friends ───────────────────────────────────────────────────────────────

    async def get_friends(self) -> Dict:
        if not self._user_info_cache.steam_id:
            return {"status": "error", "message": "Not authenticated"}

        friends_ids = await self._websocket_client.get_friends()
        friends_infos = await self._websocket_client.get_friends_info(friends_ids)

        friends = []
        for fid, info in friends_infos.items():
            friends.append({
                "userId": str(fid),
                "username": info.name,
                "avatarUrl": avatar_url_from_hash(info.avatar_hash.hex()),
                "profileUrl": f"https://steamcommunity.com/profiles/{fid}",
            })
        return {"status": "success", "friends": friends}

    # ── Achievements ──────────────────────────────────────────────────────────

    async def get_achievements(self, game_ids: list) -> Dict:
        if not self._user_info_cache.steam_id:
            return {"status": "error", "message": "Not authenticated"}

        # Normalize ids to ints for network/cache consistency.
        normalized_ids = []
        for gid in game_ids or []:
            try:
                normalized_ids.append(int(str(gid)))
            except Exception:
                continue

        if not normalized_ids:
            return {
                "status": "success",
                "achievements": {},
                "allAchievements": {},
                "achievementSchema": {},
                "progress": {},
            }

        def _normalize_key(value):
            return (
                str(value or "")
                .lower()
                .replace("™", "")
                .replace("®", "")
                .replace("©", "")
                .strip()
            )

        def _steam_icon_url(app_id, value):
            raw = str(value or "").strip()
            if not raw:
                return ""

            if raw.startswith("http://") or raw.startswith("https://"):
                return raw

            if raw.endswith(".jpg") or raw.endswith(".png"):
                return raw

            return f"https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/{app_id}/{raw}.jpg"
        
        def _pick(meta, *keys):
            for key in keys:
                val = meta.get(key)
                if val is not None and val != "":
                    return val
            return None
        
        async def _fetch_steam_schema_icons(app_id):
            """
            Fetch public Steam achievement schema/icons.
            Uses Web API first, then Steam Community XML fallback for locked icons.
            """
            import xml.etree.ElementTree as ET

            sid = str(app_id)
            cache_key = f"schema-icons:{sid}"

            def _has_any_icon(schema):
                if not isinstance(schema, dict):
                    return False
                for v in schema.values():
                    if isinstance(v, dict) and (
                        v.get("icon") or
                        v.get("icon_gray") or
                        v.get("icongray") or
                        v.get("iconGray")
                    ):
                        return True
                return False

            cached = self._achievement_schema_cache.get(cache_key)

            # مهم: لا تعتبر الكاش صالح إلا لو فيه أيقونات فعلاً
            if _has_any_icon(cached):
                return cached

            if not self._aiohttp_session:
                return {}

            schema_map = {}

            # ── 1) Try Steam Web API schema ─────────────────────────────
            api_url = f"https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid={sid}&l=english"

            try:
                async with self._aiohttp_session.get(api_url, timeout=15) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)

                        available = (
                            data.get("game", {})
                                .get("availableGameStats", {})
                                .get("achievements", [])
                        )

                        for ach in available or []:
                            internal = str(ach.get("name") or "").strip()
                            if not internal:
                                continue

                            schema_map[internal] = {
                                "internal_name": internal,
                                "name": internal,
                                "localized_name": ach.get("displayName") or internal,
                                "localized_desc": ach.get("description") or "",
                                "description": ach.get("description") or "",
                                "icon": ach.get("icon") or "",
                                "icon_gray": ach.get("icongray") or ach.get("iconGray") or ach.get("icon_gray") or "",
                                "hidden": bool(ach.get("hidden", 0)),
                            }
                    else:
                        logger.warning("Steam WebAPI schema fetch failed for %s: HTTP %s", sid, resp.status)

            except Exception as e:
                logger.warning("Steam WebAPI schema fetch error for %s: %s", sid, e)

            # ── 2) Fallback: Steam Community XML gives iconOpen/iconClosed ───────────
            # ده مهم جدًا للـ locked achievements.
            xml_urls = [
                f"https://steamcommunity.com/stats/{sid}/achievements?xml=1",
                f"https://steamcommunity.com/stats/{sid}/achievements/?xml=1",
            ]

            for xml_url in xml_urls:
                try:
                    async with self._aiohttp_session.get(xml_url, timeout=15) as resp:
                        if resp.status != 200:
                            logger.warning("Steam XML schema fetch failed for %s: HTTP %s", sid, resp.status)
                            continue

                        text = await resp.text()

                    root = ET.fromstring(text)

                    # Steam XML shape usually:
                    # <playerstats><achievements><achievement>...</achievement></achievements></playerstats>
                    xml_achievements = root.findall(".//achievement")

                    for ach in xml_achievements:
                        internal = (
                            (ach.findtext("apiname") or "")
                            or (ach.findtext("name") or "")
                        ).strip()

                        display_name = (ach.findtext("name") or internal or "Achievement").strip()
                        description = (ach.findtext("description") or "").strip()
                        icon_open = (ach.findtext("iconOpen") or "").strip()
                        icon_closed = (ach.findtext("iconClosed") or "").strip()

                        if not internal and not display_name:
                            continue

                        key = internal or display_name

                        existing = schema_map.get(key, {})

                        schema_map[key] = {
                            **existing,
                            "internal_name": existing.get("internal_name") or internal or key,
                            "name": existing.get("name") or internal or key,
                            "localized_name": existing.get("localized_name") or display_name,
                            "localized_desc": existing.get("localized_desc") or description,
                            "description": existing.get("description") or description,

                            # unlocked icon
                            "icon": existing.get("icon") or icon_open or "",

                            # locked icon
                            "icon_gray": (
                                existing.get("icon_gray")
                                or existing.get("icongray")
                                or existing.get("iconGray")
                                or icon_closed
                                or icon_open
                                or ""
                            ),

                            "hidden": bool(existing.get("hidden", False)),
                        }

                    if _has_any_icon(schema_map):
                        logger.info("Steam XML schema icons fetched for app %s: %s achievements", sid, len(schema_map))
                        break

                except Exception as e:
                    logger.warning("Steam XML schema fetch error for %s: %s", sid, e)

            if schema_map:
                self._achievement_schema_cache[cache_key] = schema_map
                logger.info(
                    "Steam schema icons ready for app %s: achievements=%s hasIcons=%s",
                    sid,
                    len(schema_map),
                    _has_any_icon(schema_map),
                )

            return schema_map

        try:
            await self._websocket_client.refresh_game_stats(normalized_ids)
            await self._stats_cache.wait_ready(60)

            if not self._stats_cache.ready:
                self._stats_cache.force_clear_stuck_import()

            # مهم: دي اللي بتخلّي achievement metadata/schema يجهز
            await self._stats_cache.wait_metadata_ready(30)

        except Exception as e:
            logger.error(f"Error getting achievements: {repr(e)}")

            # Mask technical WebSocket errors for the UI
            if "received 1000" in str(e) or "ConnectionClosed" in str(e):
                raise Exception("Steam connection lost. Please try again.")

            raise e

        achievements_result = {}
        all_achievements_result = {}
        achievement_schema_result = {}
        progress = {}

        for game_id in normalized_ids:
            sid = str(game_id)
            app_id = int(game_id) & 0xFFFFFFFF

            # Some cache implementations store keys as int, others as str.
            raw = (
                self._stats_cache.get(game_id, {})
                or self._stats_cache.get(sid, {})
                or {}
            )

            raw_unlocked = raw.get("achievements", []) or []

            # Steam metadata/schema: this should contain ALL achievements, locked + unlocked.
            # StatsCache stores it as a dict keyed by internal achievement name.
            cache_metadata_map = getattr(self._stats_cache, "_achievement_metadata", {}) or {}

            # Public Steam schema gives reliable icon/icongray URLs for locked achievements.
            schema_icon_map = await _fetch_steam_schema_icons(app_id)

            logger.info(
                "Achievements schema for app %s: schema_entries=%s cache_metadata_entries=%s",
                sid,
                len(schema_icon_map) if isinstance(schema_icon_map, dict) else 0,
                len(cache_metadata_map) if isinstance(cache_metadata_map, dict) else 0,
            )

            # ── Step 1: seed metadata_map from schema ──────────────────────
            metadata_map = {}
            schema_by_norm = {}

            if isinstance(schema_icon_map, dict):
                for schema_key, schema_value in schema_icon_map.items():
                    if not isinstance(schema_value, dict):
                        continue

                    metadata_map[schema_key] = schema_value

                    for alias in [
                        schema_key,
                        schema_value.get("internal_name"),
                        schema_value.get("name"),
                        schema_value.get("localized_name"),
                    ]:
                        nk = _normalize_key(alias)
                        if nk:
                            schema_by_norm[nk] = (schema_key, schema_value)

            # ── Step 2: overlay StatsCache metadata (names/descs/icons) ───
            if isinstance(cache_metadata_map, dict):
                for key, value in cache_metadata_map.items():
                    if not isinstance(value, dict):
                        continue

                    match = (
                        schema_by_norm.get(_normalize_key(key))
                        or schema_by_norm.get(_normalize_key(value.get("internal_name")))
                        or schema_by_norm.get(_normalize_key(value.get("name")))
                        or schema_by_norm.get(_normalize_key(value.get("localized_name")))
                    )

                    matched_schema_key = None
                    existing = {}

                    if match:
                        matched_schema_key, existing = match

                    # لو لقينا نفس الإنجاز في schema باسم مختلف، امسحه عشان ما يحصلش duplicate
                    if matched_schema_key and matched_schema_key != key:
                        metadata_map.pop(matched_schema_key, None)

                    metadata_map[key] = {
                        **existing,
                        **value,

                        # حافظ على أيقونات schema لو StatsCache مفيهوش icons
                        "icon": (
                            value.get("icon")
                            or value.get("icon_url")
                            or value.get("iconUrl")
                            or existing.get("icon")
                            or existing.get("icon_url")
                            or existing.get("iconUrl")
                            or ""
                        ),
                        "icon_gray": (
                            value.get("icon_gray")
                            or value.get("iconGray")
                            or value.get("icongray")
                            or value.get("icon_gray_url")
                            or existing.get("icon_gray")
                            or existing.get("iconGray")
                            or existing.get("icongray")
                            or existing.get("icon_gray_url")
                            or ""
                        ),
                    }

            has_schema_icons = any(
                isinstance(v, dict) and (v.get("icon") or v.get("icon_gray"))
                for v in metadata_map.values()
            )
            logger.info(
                "Merged metadata_map for app %s: entries=%s hasIcons=%s",
                sid, len(metadata_map), has_schema_icons,
            )

            # Snapshot للتشخيص فقط، لكن الفانكشن فوق تستخدم cache_key منفصل
            self._achievement_schema_cache[sid] = metadata_map

            unlocked_by_key = {}

            # 1) Build unlocked lookup from raw user achievement state
            unlocked_achievements = []
            for ach in raw_unlocked:
                internal_name = (
                    ach.get("name")
                    or ach.get("internal_name")
                    or ach.get("internalName")
                    or ""
                ).strip()

                meta = {}
                try:
                    meta = self._stats_cache.get_achievement_metadata(internal_name) or {}
                except Exception:
                    meta = metadata_map.get(internal_name) or {}

                name = (
                    _pick(meta, "localized_name", "name", "displayName")
                    or internal_name
                    or "Achievement"
                )

                description = (
                    _pick(meta, "localized_desc", "description", "desc")
                    or ach.get("description")
                    or ""
                )

                icon = (
                    ach.get("icon")
                    or _pick(meta, "icon", "icon_url")
                    or ""
                )

                icon_gray = (
                    _pick(meta, "icon_gray", "iconGray", "icongray", "icon_gray_url")
                    or icon
                    or ""
                )

                icon = _steam_icon_url(app_id, icon)
                icon_gray = _steam_icon_url(app_id, icon_gray)

                unlock_time = (
                    ach.get("unlock_time")
                    or ach.get("unlockTime")
                    or 0
                )

                unlocked_obj = {
                    "internalName": internal_name,
                    "name": name,
                    "description": description,
                    "icon": icon,
                    "iconGray": icon_gray,
                    "hidden": bool(meta.get("hidden", False)),
                    "playerPercentUnlocked": (
                        meta.get("player_percent_unlocked")
                        or meta.get("playerPercentUnlocked")
                    ),
                    "unlocked": True,
                    "unlockTime": unlock_time,
                }

                unlocked_achievements.append(unlocked_obj)

                for key in [
                    internal_name,
                    name,
                    meta.get("localized_name") if meta else None,
                ]:
                    nk = _normalize_key(key)
                    if nk:
                        unlocked_by_key[nk] = unlocked_obj

            # 2) Build ALL achievements from metadata schema
            # 2) Build ALL achievements from metadata schema
            all_achievements = []

            if metadata_map:
                for internal_name, meta in metadata_map.items():
                    if not isinstance(meta, dict):
                        continue

                    internal_name = str(
                        meta.get("internal_name")
                        or meta.get("name")
                        or internal_name
                        or ""
                    ).strip()

                    display_name = (
                        _pick(meta, "localized_name", "name", "displayName")
                        or internal_name
                        or "Achievement"
                    )

                    keys = [
                        _normalize_key(internal_name),
                        _normalize_key(display_name),
                        _normalize_key(meta.get("localized_name")),
                    ]

                    unlocked_match = None
                    for key in keys:
                        if key and key in unlocked_by_key:
                            unlocked_match = unlocked_by_key[key]
                            break

                    is_unlocked = unlocked_match is not None

                    # Metadata may have name/description but no icon.
                    # Old working path had the icon on the unlocked achievement row itself.
                    unlocked_icon = ""
                    unlocked_gray = ""

                    if unlocked_match:
                        unlocked_icon = (
                            unlocked_match.get("icon")
                            or unlocked_match.get("iconUrl")
                            or unlocked_match.get("icon_url")
                            or ""
                        )

                        unlocked_gray = (
                            unlocked_match.get("iconGray")
                            or unlocked_match.get("icon_gray")
                            or unlocked_match.get("icon_gray_url")
                            or unlocked_icon
                            or ""
                        )

                    meta_icon = (
                        _pick(meta, "icon", "icon_url", "iconUrl")
                        or ""
                    )

                    meta_gray = (
                        _pick(meta, "icon_gray", "iconGray", "icongray", "icon_gray_url")
                        or ""
                    )

                    # Priority fix:
                    # - For unlocked achievements, use the old working icon path first.
                    #   This is usually a full valid Steam CDN URL from the user achievement row.
                    # - For locked achievements, use schema gray icon first, then schema icon.
                    if is_unlocked:
                        icon = unlocked_icon or meta_icon or unlocked_gray or meta_gray or ""
                        icon_gray = unlocked_gray or meta_gray or unlocked_icon or meta_icon or ""
                    else:
                        icon = meta_icon or meta_gray or ""
                        icon_gray = meta_gray or meta_icon or ""

                    all_achievements.append({
                        "internalName": internal_name,
                        "name": display_name,
                        "description": (
                            _pick(meta, "localized_desc", "description", "desc")
                            or ""
                        ),
                        "icon": _steam_icon_url(app_id, icon),
                        "iconGray": _steam_icon_url(app_id, icon_gray),
                        "hidden": bool(meta.get("hidden", False)),
                        "playerPercentUnlocked": (
                            meta.get("player_percent_unlocked")
                            or meta.get("playerPercentUnlocked")
                        ),
                        "unlocked": is_unlocked,
                        "unlockTime": unlocked_match.get("unlockTime", 0) if unlocked_match else 0,
                    })

            # 3) Fallback: لو Steam ما رجّعش schema، ارجع المفتوح فقط
            if not all_achievements:
                all_achievements = unlocked_achievements

            unlocked_count = len([a for a in all_achievements if a.get("unlocked")])
            total_count = len(all_achievements) if all_achievements else None

            achievements_result[sid] = unlocked_achievements
            all_achievements_result[sid] = all_achievements
            achievement_schema_result[sid] = all_achievements

            progress[sid] = {
                "totalCount": total_count,
                "unlocked": unlocked_count,
            }

            logger.info(
                "Achievements built for app %s: unlocked=%s total=%s schema=%s",
                sid,
                unlocked_count,
                total_count,
                len(metadata_map) if metadata_map else 0,
            )

        return {
            "status": "success",

            # القديم: المفتوح فقط — نسيبه للتوافق
            "achievements": achievements_result,

            # الجديد: كل الإنجازات unlocked + locked
            "allAchievements": all_achievements_result,
            "achievementSchema": achievement_schema_result,

            "progress": progress,
        }

    # ── Game Time ─────────────────────────────────────────────────────────────

    async def get_game_times(self) -> Dict:
        if not self._user_info_cache.steam_id:
            return {"status": "error", "message": "Not authenticated"}

        await self._websocket_client.refresh_game_times()
        # Reduced timeout from 10min to 15s to prevent UI hang if Steam doesn't respond.
        await self._times_cache.wait_ready(15)

        times = {}
        for game_id, data in self._times_cache._cache.items():
            last_played = data.get("last_played")
            if last_played == GAME_DOES_NOT_SUPPORT_LAST_PLAYED_VALUE:
                last_played = None
            times[str(game_id)] = {
                "timePlayed": data.get("time_played"),
                "lastPlayed": last_played,
            }
        return {"status": "success", "times": times}

    # ── Persistent cache (Electron passes this in on startup) ─────────────────

    def load_persistent_cache(self, cache: Dict):
        self._persistent_cache = cache
        if "games" in cache:
            self._games_cache.loads(cache["games"])
        logger.info("Persistent cache loaded")

    def get_persistent_cache(self) -> Dict:
        return self._persistent_cache


# ═════════════════════════════════════════════════════════════════════════════
# Minimal aiohttp-based SteamHttpClient (replaces galaxy.http dependency)
# ═════════════════════════════════════════════════════════════════════════════

class _AiohttpSteamHttpClient:
    """Wraps aiohttp.ClientSession to match SteamHttpClient's interface."""

    def __init__(self, session):
        self._session = session

    async def get_servers(self, cell_id: int):
        url = f"https://api.steampowered.com/ISteamDirectory/GetCMListForConnect/v1/?cellid={cell_id}&format=json"
        async with self._session.get(url) as resp:
            data = await resp.json()
            return [
                s["endpoint"]
                for s in data.get("response", {}).get("serverlist", [])
                if s.get("type") == "websockets"
            ]


# ═════════════════════════════════════════════════════════════════════════════
# JSON-RPC I/O loop
# ═════════════════════════════════════════════════════════════════════════════

class BaddelBridgeServer:
    """Reads JSON-RPC from stdin, dispatches to BaddelSteamBridge, writes results to stdout."""

    def __init__(self):
        self._bridge: Optional[BaddelSteamBridge] = None
        self._stdout_lock = asyncio.Lock()

    async def _send(self, obj: Dict):
        async with self._stdout_lock:
            line = json.dumps(obj) + "\n"
            sys.stdout.write(line)
            sys.stdout.flush()

    async def _push_event(self, event: str, data: Any):
        await self._send({"event": event, "data": data})

    async def _handle(self, req: Dict) -> Dict:
        req_id = req.get("id")
        method = req.get("method", "")
        params = req.get("params", {})

        try:
            result = await self._dispatch(method, params)
            return {"id": req_id, "result": result}
        except Exception as e:
            logger.exception(f"Error handling {method}")
            return {"id": req_id, "error": str(e)}

    async def _dispatch(self, method: str, params: Dict) -> Any:
        b = self._bridge

        if method == "ping":
            return "pong"

        elif method == "start":
            cache = params.get("persistentCache", {})
            await b.start()
            b.load_persistent_cache(cache)
            return {"status": "ok"}

        elif method == "authenticate":
            creds = params.get("storedCredentials")
            return await b.authenticate(creds)

        elif method == "logout":
            await b.logout()
            return {"status": "ok"}

        elif method == "pass_login_credentials":
            return await b.pass_login_credentials(
                params.get("end_uri", ""),
                params
            )

        elif method == "start_qr_login":
            return await b.start_qr_login()

        elif method == "start_password_login":
            return await b.start_password_login(
                params.get("username", ""),
                params.get("password", "")
            )

        elif method == "submit_steam_guard_code":
            return await b.submit_steam_guard_code(
                params.get("code", ""),
                params.get("method", "email")
            )

        elif method == "poll_auth_status":
            return await b.poll_auth_status()

        elif method == "get_owned_games":
            return await b.get_owned_games()

        elif method == "get_friends":
            return await b.get_friends()

        elif method == "get_achievements":
            return await b.get_achievements(params.get("gameIds", []))

        elif method == "get_game_times":
            return await b.get_game_times()

        elif method == "get_persistent_cache":
            return b.get_persistent_cache()

        elif method == "shutdown":
            await b.shutdown()
            return {"status": "ok"}

        else:
            raise ValueError(f"Unknown method: {method}")

    async def run(self):
        self._bridge = BaddelSteamBridge(push_event_fn=self._push_event)

        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        if sys.platform == "win32":
            # Windows: connect_read_pipe not supported, use executor thread
            import threading
            def _stdin_reader():
                try:
                    for line in sys.stdin:
                        loop.call_soon_threadsafe(protocol.data_received, line.encode())
                except Exception:
                    pass
                loop.call_soon_threadsafe(protocol.eof_received)
            t = threading.Thread(target=_stdin_reader, daemon=True)
            t.start()
        else:
            await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        logger.info("Baddel Steam Bridge ready — waiting for commands")

        tick_task = asyncio.create_task(self._tick_loop())

        try:
            while True:
                line = await reader.readline()
                if not line:
                    logger.info("stdin closed — shutting down")
                    break
                line = line.decode("utf-8").strip()
                if not line:
                    continue
                try:
                    req = json.loads(line)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON: {e}")
                    continue

                # Handle each request in a separate task so we don't block
                asyncio.create_task(self._handle_and_send(req))

        finally:
            tick_task.cancel()
            try:
                await tick_task
            except asyncio.CancelledError:
                pass
            if self._bridge:
                await self._bridge.shutdown()

    async def _handle_and_send(self, req: Dict):
        response = await self._handle(req)
        await self._send(response)

    async def _tick_loop(self):
        while True:
            await asyncio.sleep(2)
            if self._bridge:
                try:
                    await self._bridge.tick()
                except Exception:
                    logger.exception("Error in tick")


# ═════════════════════════════════════════════════════════════════════════════
# Entry point
# ═════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    server = BaddelBridgeServer()
    asyncio.run(server.run())