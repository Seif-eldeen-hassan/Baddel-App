f = r'E:\Baddel\Baddel-App\platformSync.js'
content = open(f, encoding='utf-8').read()

old = """        const win = new BrowserWindow({
            width: 500, height: 500,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
            frame: false,
            backgroundColor: '#1a1a2e',
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
            title: 'Connect Steam',
        });"""

new = """        const win = new BrowserWindow({
            width: 500, height: 600,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
            frame: false,
            backgroundColor: '#1a1a2e',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: false,
                allowRunningInsecureContent: true,
            },
            title: 'Connect Steam',
        });"""

if old in content:
    content = content.replace(old, new)
    open(f, 'w', encoding='utf-8').write(content)
    print('Done')
else:
    print('Pattern not found')
