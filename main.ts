import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './server.js';

function hostIsPublic(value: string | undefined) { return value === '0.0.0.0' || value === '::'; }

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
const token = process.env.MLEDGER_API_TOKEN;
if (hostIsPublic(process.env.HOST) && (!token || token.length < 32)) throw new Error('When binding publicly, set MLEDGER_API_TOKEN to at least 32 characters.');
const handler = createMcpHandler(() => createServer());
const nodeHandler = toNodeHandler(handler);
const host = process.env.HOST ?? '127.0.0.1';
const allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map(x => x.trim()).filter(Boolean);
if (hostIsPublic(host) && allowedHosts.length === 0) throw new Error('Set ALLOWED_HOSTS when binding to a public interface');
const app = createMcpExpressApp({ host, ...(hostIsPublic(host) ? { allowedHosts } : {}) });
app.get('/health', (_req, res) => res.json({ ok: true, service: 'm-ledger', mode: 'sandbox' }));
app.all('/mcp', (req, res) => {
  if (token && req.headers.authorization !== `Bearer ${token}`) { res.status(401).json({ error: 'Unauthorized' }); return; }
  void nodeHandler(req, res, req.body);
});
app.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`M-Ledger MCP server listening on http://${process.env.HOST ?? '127.0.0.1'}:${port}/mcp`));
