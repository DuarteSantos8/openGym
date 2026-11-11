import http from 'node:http';
import { REDIRECT_URI } from './chatgpt-plan.js';

export const LOOPBACK_PORT = Number(new URL(REDIRECT_URI).port);
export const chatGptLoopbackOn = (env = process.env) => /^(1|true|yes|on)$/i.test(env.COACH_CHATGPT_LOOPBACK || '');

export function listenForChatGptCallback(capture, port = LOOPBACK_PORT) {
  const redirect = new URL(REDIRECT_URI);
  // The Docker override explicitly binds inside the container and publishes to host loopback.
  const bind = process.env.COACH_CHATGPT_LOOPBACK_BIND === '0.0.0.0' ? '0.0.0.0' : redirect.hostname;
  const server = http.createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
    let callback;
    try { if (req.url?.startsWith('/')) callback = new URL(req.url, redirect); } catch { /* malformed URL */ }
    const accepted = req.method === 'GET' && req.headers.host === redirect.host &&
      callback?.origin === redirect.origin && callback.pathname === redirect.pathname && capture(callback);
    res.writeHead(accepted ? 200 : 400, {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'", Connection: 'close'
    });
    res.end(accepted ? 'Return to openGym to finish signing in.' : 'No matching openGym sign-in.');
  });
  const ready = new Promise(resolve => {
    server.once('listening', () => {
      const boundPort = server.address().port;
      redirect.port = String(boundPort);
      server.unref();
      resolve(boundPort);
    });
    server.once('close', () => resolve(false));
    server.on('error', () => resolve(false));
    server.listen(port, bind);
  });
  return { ready, close: () => server.close() };
}
