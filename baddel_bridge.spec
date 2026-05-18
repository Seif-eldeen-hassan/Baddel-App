# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['E:\\Baddel\\Baddel-App\\baddel-steam-integration\\src\\baddel_bridge.py'],
    pathex=['E:\\Baddel\\Baddel-App\\baddel-steam-integration\\src', 'E:\\Baddel\\Baddel-App\\baddel-steam-integration\\src\\steam_network\\protocol\\messages'],
    binaries=[],
    datas=[('E:\\Baddel\\Baddel-App\\baddel-steam-integration\\src\\steam_network', 'steam_network'), ('E:\\Baddel\\Baddel-App\\baddel-steam-integration\\src\\commonWeb', 'commonWeb')],
    hiddenimports=['aiohttp', 'websockets', 'rsa', 'certifi', 'cryptography', 'dataclasses_json', 'vdf', 'google.protobuf', 'steam_network', 'steam_network.protocol', 'steam_network.protocol.messages', 'encrypted_app_ticket_pb2', 'enums_pb2', 'service_cloudconfigstore_pb2', 'steammessages_auth_pb2', 'steammessages_base_pb2', 'steammessages_chat_pb2', 'steammessages_client_objects_pb2', 'steammessages_clientserver_2_pb2', 'steammessages_clientserver_appinfo_pb2', 'steammessages_clientserver_friends_pb2', 'steammessages_clientserver_login_pb2', 'steammessages_clientserver_pb2', 'steammessages_clientserver_userstats_pb2', 'steammessages_player_pb2', 'steammessages_unified_base_pb2', 'steammessages_webui_friends_pb2'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='baddel_bridge',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
