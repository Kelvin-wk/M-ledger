import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import * as z from 'zod/v4';
import { createInvoice, createSettlement, confirmSettlement, estimateConversion, getSummary, listInvoices, listSettlements, seedDemoData } from './src/ledger.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UI_URI = 'ui://m-ledger/settlement-dashboard.html';
const currency = z.enum(['KES', 'USD', 'USDC']);

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}
function publicSettlement<T extends { confirmationToken?: string }>(settlement: T) {
  const { confirmationToken, ...visible } = settlement;
  void confirmationToken;
  return visible;
}

export function createServer() {
  seedDemoData();
  const server = new McpServer({ name: 'm-ledger', version: '0.1.0' });

  registerAppTool(server, 'mledger_dashboard', {
    title: 'M-Ledger dashboard',
    description: 'Get invoice and settlement totals and open the M-Ledger interactive dashboard. All records in this build are sandbox examples.',
    inputSchema: z.object({}),
    _meta: { ui: { resourceUri: UI_URI } }
  }, async () => textResult({ summary: getSummary(), invoices: listInvoices(), settlements: listSettlements().map(publicSettlement), mode: 'SANDBOX' }));

  server.registerTool('mledger_list_invoices', {
    title: 'List invoices',
    description: 'List M-Ledger invoices, optionally filtering by status or currency. Sandbox ledger only.',
    inputSchema: z.object({ status: z.enum(['open', 'partially_settled', 'settled']).optional(), currency: currency.optional(), limit: z.number().int().min(1).max(100).default(25) })
  }, async ({ status, currency: c, limit }) => {
    const data = listInvoices().filter(i => (!status || i.status === status) && (!c || i.currency === c)).slice(0, limit);
    return textResult({ invoices: data, count: data.length, sandbox: true });
  });

  server.registerTool('mledger_create_invoice', {
    title: 'Create invoice',
    description: 'Create a local invoice record in the M-Ledger sandbox. Does not request or move funds.',
    inputSchema: z.object({ reference: z.string().trim().min(3).max(40), customer: z.string().trim().min(2).max(100), description: z.string().trim().min(3).max(180), amount: z.number().positive().max(1_000_000_000), currency, dueDate: z.iso.date() })
  }, async input => {
    try { return textResult({ invoice: createInvoice(input), sandbox: true }); }
    catch (e) { return textResult({ error: e instanceof Error ? e.message : 'Unable to create invoice' }); }
  });

  server.registerTool('mledger_estimate_fx', {
    title: 'Estimate currency conversion',
    description: 'Calculate an indicative KES, USD or USDC conversion using a clearly labelled demo rate. Not a live quote or offer.',
    inputSchema: z.object({ amount: z.number().positive().max(1_000_000_000), from: currency, to: currency })
  }, async ({ amount, from, to }) => {
    try { return textResult(estimateConversion(amount, from, to)); }
    catch (e) { return textResult({ error: e instanceof Error ? e.message : 'Unable to estimate FX' }); }
  });

  server.registerTool('mledger_request_settlement', {
    title: 'Request settlement',
    description: 'Create a pending sandbox settlement instruction for an invoice. This never calls M-Pesa, a bank, or a blockchain. A separate explicit confirmation is required to mark the demo ledger entry completed.',
    inputSchema: z.object({ invoiceId: z.string().uuid(), amount: z.number().positive().max(1_000_000_000), sourceCurrency: currency, destinationCurrency: currency, destination: z.string().trim().min(5).max(120), rail: z.enum(['mpesa_sandbox', 'bank_sandbox', 'stablecoin_sandbox']), idempotencyKey: z.string().trim().min(8).max(80) })
  }, async input => {
    try { return textResult({ settlement: publicSettlement(createSettlement(input)), sandbox: true, nextStep: 'Review the exact destination and amount in the M-Ledger UI. Confirmation is available only through the app after the user approves.' }); }
    catch (e) { return textResult({ error: e instanceof Error ? e.message : 'Unable to request settlement' }); }
  });

  registerAppTool(server, 'mledger_get_confirmation_challenge', {
    title: 'Get settlement confirmation challenge',
    description: 'Internal UI-only operation. Retrieve the one-time confirmation token for a pending settlement after the user has reviewed and approved its exact details.',
    inputSchema: z.object({ settlementId: z.string().uuid() }),
    _meta: { ui: { resourceUri: UI_URI, visibility: ['app'] } }
  }, async ({ settlementId }) => {
    const settlement = listSettlements().find(s => s.id === settlementId);
    if (!settlement || settlement.status !== 'pending_confirmation') return textResult({ error: 'No pending settlement found' });
    return textResult({ settlementId, confirmationToken: settlement.confirmationToken });
  });

  registerAppTool(server, 'mledger_confirm_settlement', {
    title: 'Confirm sandbox settlement',
    description: 'After the user explicitly approves the displayed settlement details, mark that sandbox ledger entry completed. This is a simulation only and cannot move money.',
    inputSchema: z.object({ settlementId: z.string().uuid(), confirmationToken: z.string().uuid(), confirmed: z.literal(true).describe('The UI supplies this only after the user approves the exact displayed settlement.') }),
    _meta: { ui: { resourceUri: UI_URI, visibility: ['app'] } },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ settlementId, confirmationToken, confirmed }) => {
    try { return textResult({ settlement: publicSettlement(confirmSettlement(settlementId, confirmationToken, confirmed)), sandbox: true }); }
    catch (e) { return textResult({ error: e instanceof Error ? e.message : 'Unable to confirm settlement' }); }
  });

  server.registerTool('mledger_list_settlements', {
    title: 'List settlements',
    description: 'List settlement instructions and their sandbox statuses.',
    inputSchema: z.object({ status: z.enum(['pending_confirmation', 'processing', 'completed', 'failed']).optional(), limit: z.number().int().min(1).max(100).default(25) })
  }, async ({ status, limit }) => {
    const data = listSettlements().filter(s => !status || s.status === status).slice(0, limit);
    return textResult({ settlements: data.map(publicSettlement), count: data.length, sandbox: true });
  });

  registerAppResource(server, 'M-Ledger Settlement Dashboard', UI_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await readFile(path.join(ROOT, 'dist', 'mcp-app.html'), 'utf8');
    return { contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });
  return server;
}
