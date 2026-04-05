f = r'E:\Baddel\Baddel-App\platformSync.js'
content = open(f, encoding='utf-8').read()

old = """        win.webContents.on('did-navigate', (_e, url) => checkUrl(url));
        win.webContents.on('did-navigate-in-page', (_e, url) => checkUrl(url));
        win.on('closed', () => reject(new Error('Steam login window closed.')));"""

new = """        win.webContents.on('will-navigate', (_e, url) => { _e.preventDefault(); checkUrl(url); });
        win.webContents.on('did-navigate', (_e, url) => checkUrl(url));
        win.webContents.on('did-navigate-in-page', (_e, url) => checkUrl(url));
        win.on('closed', () => reject(new Error('Steam login window closed.')));"""

if old in content:
    content = content.replace(old, new)
    open(f, 'w', encoding='utf-8').write(content)
    print('Done')
else:
    print('Pattern not found')
