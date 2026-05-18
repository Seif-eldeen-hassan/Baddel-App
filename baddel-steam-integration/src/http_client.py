import aiohttp
import ssl
import certifi

class HttpClient:
    def __init__(self):
        self._session = None

    async def __aenter__(self):
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        self._session = aiohttp.ClientSession(connector=connector)
        return self

    async def __aexit__(self, *args):
        if self._session:
            await self._session.close()

    async def get(self, url, **kwargs):
        return await self._session.get(url, **kwargs)

    async def post(self, url, **kwargs):
        return await self._session.post(url, **kwargs)

    @property
    def session(self):
        return self._session
