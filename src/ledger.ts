import { randomUUID } from 'node:crypto';

export type Currency = 'KES' | 'USD' | 'USDC';
export type InvoiceStatus = 'open' | 'partially_settled' | 'settled';
export type SettlementStatus = 'pending_confirmation' | 'processing' | 'completed' | 'failed';
export interface Invoice {
  id: string; reference: string; customer: string; description: string; amount: number;
  currency: Currency; dueDate: string; createdAt: string; status: InvoiceStatus;
}
export interface Settlement {
  id: string; confirmationToken: string; invoiceId: string; amount: number; sourceCurrency: Currency; destinationCurrency: Currency;
  destination: string; rail: 'mpesa_sandbox' | 'bank_sandbox' | 'stablecoin_sandbox'; status: SettlementStatus;
  createdAt: string; idempotencyKey: string; note: string;
}

const invoices: Invoice[] = [];
const settlements: Settlement[] = [];
const idempotency = new Map<string, string>();
const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function resetLedger() { invoices.length = 0; settlements.length = 0; idempotency.clear(); }
export function seedDemoData() {
  if (invoices.length) return;
  const examples: Omit<Invoice, 'id'|'createdAt'|'status'>[] = [
    { reference: 'ML-2026-001', customer: 'Kibo Logistics Ltd', description: 'Regional freight services · Kampala', amount: 245000, currency: 'KES', dueDate: '2026-11-24' },
    { reference: 'ML-2026-002', customer: 'Nairobi Digital Studio', description: 'Product design retainer · Kigali', amount: 1850, currency: 'USD', dueDate: '2026-11-28' },
    { reference: 'ML-2026-003', customer: 'Lakeview Supplies', description: 'Wholesale inventory · Dar es Salaam', amount: 98000, currency: 'KES', dueDate: '2026-12-02' },
    { reference: 'ML-2026-004', customer: 'Amani Exports', description: 'Agricultural exports · Dubai', amount: 3200, currency: 'USDC', dueDate: '2026-12-05' }
  ];
  for (const e of examples) invoices.push({ ...e, id: randomUUID(), createdAt: now(), status: 'open' });
}
export function listInvoices() { return invoices.map(x => ({ ...x })); }
export function listSettlements() { return settlements.map(x => ({ ...x })); }
export function getSummary() {
  const remaining = (invoice: Invoice) => invoice.amount - settlements.filter(x => x.invoiceId === invoice.id && x.status === 'completed').reduce((sum, x) => sum + x.amount, 0);
  const totalKES = invoices.filter(i => i.currency === 'KES').reduce((s, i) => s + Math.max(0, remaining(i)), 0);
  const totalUSD = invoices.filter(i => i.currency !== 'KES').reduce((s, i) => s + Math.max(0, remaining(i)), 0);
  return { invoiceCount: invoices.length, openCount: invoices.filter(i => i.status !== 'settled').length,
    settlementCount: settlements.length, completedCount: settlements.filter(s => s.status === 'completed').length,
    pendingCount: settlements.filter(s => s.status === 'pending_confirmation' || s.status === 'processing').length,
    totalKES: round2(totalKES), totalUSD: round2(totalUSD), sandbox: true };
}
export function createInvoice(input: { reference: string; customer: string; description: string; amount: number; currency: Currency; dueDate: string }) {
  if (invoices.some(i => i.reference.toLowerCase() === input.reference.toLowerCase())) throw new Error('Invoice reference already exists');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000_000) throw new Error('Amount must be greater than zero and within the supported limit');
  const invoice: Invoice = { ...input, id: randomUUID(), createdAt: now(), status: 'open' };
  invoices.unshift(invoice);
  return { ...invoice };
}
export function createSettlement(input: { invoiceId: string; amount: number; sourceCurrency: Currency; destinationCurrency: Currency; destination: string; rail: Settlement['rail']; idempotencyKey: string }) {
  const priorId = idempotency.get(input.idempotencyKey);
  if (priorId) {
    const prior = settlements.find(s => s.id === priorId)!;
    const sameRequest = prior.invoiceId === input.invoiceId && prior.amount === round2(input.amount) && prior.sourceCurrency === input.sourceCurrency && prior.destinationCurrency === input.destinationCurrency && prior.destination === input.destination && prior.rail === input.rail;
    if (!sameRequest) throw new Error('Idempotency key has already been used for a different settlement request');
    return { ...prior };
  }
  const invoice = invoices.find(i => i.id === input.invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > invoice.amount) throw new Error('Settlement amount must be positive and cannot exceed invoice amount');
  if (input.sourceCurrency !== invoice.currency) throw new Error('Settlement source currency must match the invoice currency');
  const reserved = settlements.filter(x => x.invoiceId === invoice.id && x.status !== 'failed').reduce((sum, x) => sum + x.amount, 0);
  if (input.amount > invoice.amount - reserved) throw new Error('Settlement amount exceeds the remaining invoice balance');
  if (input.destination.trim().length < 5 || input.destination.length > 120) throw new Error('Destination must contain 5–120 characters');
  const s: Settlement = { id: randomUUID(), confirmationToken: randomUUID(), invoiceId: invoice.id, amount: round2(input.amount), sourceCurrency: input.sourceCurrency,
    destinationCurrency: input.destinationCurrency, destination: input.destination, rail: input.rail,
    status: 'pending_confirmation', createdAt: now(), idempotencyKey: input.idempotencyKey,
    note: 'Sandbox only. No funds have moved.' };
  settlements.unshift(s); idempotency.set(input.idempotencyKey, s.id);
  return { ...s };
}
export function confirmSettlement(id: string, confirmationToken: string, confirmed: boolean) {
  const s = settlements.find(x => x.id === id);
  if (!s) throw new Error('Settlement not found');
  if (!confirmed) throw new Error('Explicit confirmation is required to advance a settlement');
  if (s.confirmationToken !== confirmationToken) throw new Error('Invalid settlement confirmation token');
  if (s.status === 'completed') return { ...s };
  if (s.status !== 'pending_confirmation') throw new Error(`Settlement cannot be confirmed from status ${s.status}`);
  s.status = 'completed'; s.note = 'Sandbox settlement completed. This is a simulated ledger entry; no funds moved.';
  const invoice = invoices.find(i => i.id === s.invoiceId);
  if (invoice) {
    const completed = settlements.filter(x => x.invoiceId === invoice.id && x.status === 'completed').reduce((sum, x) => sum + x.amount, 0);
    invoice.status = completed >= invoice.amount ? 'settled' : completed > 0 ? 'partially_settled' : 'open';
  }
  return { ...s };
}
export function estimateConversion(amount: number, from: Currency, to: Currency) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('Amount must be positive and within the supported limit');
  // Indicative demo rates only; replace with a licensed FX/liquidity provider before production.
  const kesPerUsd = 129.5;
  const usd = from === 'KES' ? amount / kesPerUsd : amount;
  const converted = to === 'KES' ? usd * kesPerUsd : usd;
  return { inputAmount: round2(amount), from, outputAmount: round2(converted), to, indicativeRate: from === 'KES' && to !== 'KES' ? 1 / kesPerUsd : from !== 'KES' && to === 'KES' ? kesPerUsd : 1,
    rateLabel: 'Illustrative demo rate · not executable', asOf: now(), feeEstimate: 0, disclaimer: 'Indicative only. Confirm live rates and fees with your regulated provider.' };
}
