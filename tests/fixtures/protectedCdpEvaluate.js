'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function main() {
    const port = Number(process.argv[2] || 9333);
    const input = process.argv.slice(3).join(' ');
    const expression = input.startsWith('@')
        ? fs.readFileSync(path.resolve(input.slice(1)), 'utf8')
        : input;
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = pages.find((item) => item.type === 'page' && /index\.html(?:$|[?#])/.test(item.url));
    if (!page) throw new Error('Protected Baddel renderer was not found');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    const id = 1;
    socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
    }));
    const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP evaluation timed out')), 360000);
        socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data));
            if (payload.id !== id) return;
            clearTimeout(timer);
            resolve(payload);
        });
    });
    socket.close();
    if (response.error) throw new Error(response.error.message);
    if (response.result?.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
    }
    process.stdout.write(JSON.stringify(response.result?.result?.value ?? null, null, 2));
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
