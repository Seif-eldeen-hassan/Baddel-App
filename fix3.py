import sys
f = r'E:\Baddel\Baddel-App\baddel-steam-integration\src\baddel_bridge.py'
content = open(f, encoding='utf-8').read()
patch = '''import sys
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
'''
if 'WindowsSelectorEventLoopPolicy' not in content:
    # insert after the first line that starts with 'import'
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if line.startswith('import') or line.startswith('from'):
            lines.insert(i, patch)
            break
    open(f, 'w', encoding='utf-8').write('\n'.join(lines))
    print('Done')
else:
    print('Already patched')
