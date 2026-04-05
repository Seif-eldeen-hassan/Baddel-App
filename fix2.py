import re
f = r'E:\Baddel\Baddel-App\baddel-steam-integration\src\steam_network\steam_http_client.py'
content = open(f, encoding='utf-8').read()
content = content.replace('from http_client import HttpClient', 'import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); from http_client import HttpClient')
open(f, 'w', encoding='utf-8').write(content)
print('Done')
