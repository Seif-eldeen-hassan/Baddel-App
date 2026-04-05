import sys

f = r'E:\Baddel\Baddel-App\baddel-steam-integration\src\baddel_bridge.py'
content = open(f, encoding='utf-8').read()

# Replace the run method's stdin handling with a Windows-compatible version
old = 'await loop.connect_read_pipe(lambda: protocol, sys.stdin)'
new = '''if sys.platform == "win32":
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
            await loop.connect_read_pipe(lambda: protocol, sys.stdin)'''

if old in content:
    content = content.replace(old, new)
    open(f, 'w', encoding='utf-8').write(content)
    print('Done')
else:
    print('Pattern not found - printing lines around stdin:')
    for i, line in enumerate(content.split('\n')):
        if 'stdin' in line or 'read_pipe' in line:
            print(f'{i}: {line}')
