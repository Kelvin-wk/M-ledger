import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createServer } from './server.js';
import {
  createAttestationHash,
  firebaseServerConfig,
  rateLimit,
  requireFirebaseAuth,
  securityHeaders,
  verifyFirebaseIdToken,
  type AuthenticatedRequest,
} from './src/authMiddleware.js';
import { estimateConversion } from './src/ledger.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(ROOT, 'dist');
const HTML_ENTRY = path.join(DIST_DIR, 'mcp-app.html');

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const eq = process.argv.find(arg => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

function hostIsPublic(value: string | undefined) {
  return value === '0.0.0.0' || value === '::';
}

const port = Number(readArg('--port') ?? process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

const host = readArg('--host') ?? process.env.HOST ?? '0.0.0.0';
const token = process.env.MLEDGER_API_TOKEN;
const allowedHosts = (process.env.ALLOWED_HOSTS ?? '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const handler = createMcpHandler(() => createServer());
const nodeHandler = toNodeHandler(handler);

const app = createMcpExpressApp({
  host,
  ...(hostIsPublic(host) && allowedHosts.length > 0 ? { allowedHosts } : {}),
});

app.set('trust proxy', 1);
app.use(securityHeaders);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'm-ledger',
    mode: 'sandbox',
    auth: 'firebase',
    projectId: firebaseServerConfig.projectId || null,
  });
});

// Secure authenticated backend endpoints
app.use('/api', rateLimit(120, 60_000));

app.get('/api/session', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    authenticated: true,
    user: req.user,
    projectId: firebaseServerConfig.projectId,
    databaseId: firebaseServerConfig.firestoreDatabaseId ?? '(default)',
    security: {
      tokenVerified: true,
      firestoreRulesEnforced: true,
    },
  });
});

const attestSettlementSchema = z.object({
  invoiceId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  amount: z.number().positive().max(1_000_000_000),
  sourceCurrency: z.enum(['KES', 'USD', 'USDC']),
  destinationCurrency: z.enum(['KES', 'USD', 'USDC']),
  destination: z.string().trim().min(5).max(120),
  rail: z.enum(['mpesa_sandbox', 'bank_sandbox', 'stablecoin_sandbox']),
  idempotencyKey: z.string().trim().min(8).max(80),
});

app.post('/api/security/attest-settlement', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
  const parsed = attestSettlementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settlement payload.' });
    return;
  }
  const uid = req.user!.uid;
  const confirmationToken = randomUUID();
  const attestationHash = createAttestationHash(uid, 'request_settlement', {
    ...parsed.data,
    confirmationToken,
  });
  res.json({
    confirmationToken,
    attestationHash,
    verifiedBy: uid,
    verifiedAt: new Date().toISOString(),
  });
});

const verifyConfirmationSchema = z.object({
  settlementId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  invoiceId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  confirmationToken: z.string().trim().min(8).max(128),
  confirmed: z.literal(true),
});

app.post('/api/security/verify-confirmation', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
  const parsed = verifyConfirmationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Explicit confirmation and valid tokens are required.' });
    return;
  }
  const uid = req.user!.uid;
  const attestationHash = createAttestationHash(uid, 'confirm_settlement', parsed.data);
  res.json({
    verified: true,
    attestationHash,
    verifiedAt: new Date().toISOString(),
  });
});

const fxQuoteSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  from: z.enum(['KES', 'USD', 'USDC']),
  to: z.enum(['KES', 'USD', 'USDC']),
});

app.post('/api/security/fx-quote', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
  const parsed = fxQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid FX quote request.' });
    return;
  }
  try {
    const quote = estimateConversion(parsed.data.amount, parsed.data.from, parsed.data.to);
    res.json(quote);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to estimate FX.' });
  }
});

// MCP endpoint (supports MLEDGER_API_TOKEN or Firebase ID token when configured)
app.all('/mcp', rateLimit(120, 60_000), async (req, res) => {
  if (token) {
    const authHeader = req.headers.authorization ?? '';
    if (authHeader !== `Bearer ${token}`) {
      if (authHeader.startsWith('Bearer ')) {
        try {
          await verifyFirebaseIdToken(authHeader.slice('Bearer '.length).trim());
        } catch {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      } else {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
  }
  void nodeHandler(req, res, req.body);
});

// Serve built frontend dashboard & assets
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

app.use((req, res, next) => {
  if (
    req.method === 'GET'
    && !req.path.startsWith('/api/')
    && req.path !== '/mcp'
    && req.path !== '/health'
  ) {
    if (existsSync(HTML_ENTRY)) {
      res.sendFile(HTML_ENTRY);
      return;
    }
    res.status(503).send('M-Ledger frontend bundle not built yet. Run npm run build.');
    return;
  }
  next();
});

app.listen(port, host, () => {
  console.log(`M-Ledger server listening on http://${host}:${port} (MCP: /mcp, Health: /health)`);
});
