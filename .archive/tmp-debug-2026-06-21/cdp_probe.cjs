// CDP probe helper — small node script that connects to a Chrome /
// WebView2 remote-debugging session and runs a list of expression
// evaluations, then exits.  Used by M2.x-inline to verify layout
// decisions on the real exe (display: flex, grid, sidebar width,
// header chrome cluster y-coordinate, etc).
const ws = require('ws');
const wsUrl = process.argv[2];
const probes = JSON.parse(process.argv[3]);

const sock = new ws(wsUrl);
let nextId = 1;

function send(expr) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    sock.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true, awaitPromise: true },
      }),
    );
    const handler = (msg) => {
      const data = JSON.parse(msg.toString());
      if (data.id === id) {
        sock.off('message', handler);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result?.result?.value);
      }
    };
    sock.on('message', handler);
  });
}

sock.on('open', async () => {
  for (const p of probes) {
    try {
      const v = await send(p.expr);
      console.log(p.label + ' = ' + JSON.stringify(v));
    } catch (e) {
      console.log(p.label + ' = ERROR ' + e.message);
    }
  }
  sock.close();
  process.exit(0);
});
sock.on('error', (e) => {
  console.error('WS error:', e.message);
  process.exit(1);
});