f = r'E:\Baddel\Baddel-App\platformSync.js'
content = open(f, encoding='utf-8').read()

old = "        win.loadURL(authResult.loginUrl);"
new = """        win.loadURL(authResult.loginUrl);
        win.webContents.openDevTools({ mode: 'detach' });"""

if old in content:
    content = content.replace(old, new, 1)
    open(f, 'w', encoding='utf-8').write(content)
    print('Done')
else:
    print('Not found')
