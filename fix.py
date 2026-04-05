content = open(r'E:\Baddel\Baddel-App\steamBridge.js', encoding='utf-8').read()
old = "'C:\\\\\\\\Users\\\\\\\\seife\\\\\\\\AppData\\\\\\\\Local\\\\\\\\Programs\\\\\\\\Python\\\\\\\\Python311\\\\\\\\python.exe'"
new = "'C:\\\\Users\\\\seife\\\\AppData\\\\Local\\\\Programs\\\\Python\\\\Python311\\\\python.exe'"
content = content.replace(old, new)
open(r'E:\Baddel\Baddel-App\steamBridge.js', 'w', encoding='utf-8').write(content)
print('Done')
