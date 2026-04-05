f = r'E:\Baddel\Baddel-App\platformSync.js'
content = open(f, encoding='utf-8').read()

stub = '''
async function getLocalSteamGames() {
    return [];
}

'''

# Insert before steamConnector
if 'getLocalSteamGames' not in content:
    content = content.replace('// ─── steamConnector', stub + '// ─── steamConnector')
    open(f, 'w', encoding='utf-8').write(content)
    print('Done')
else:
    print('Already exists')
