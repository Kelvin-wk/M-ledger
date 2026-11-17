import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmSettlement, createInvoice, createSettlement, estimateConversion, getSummary, listInvoices, listSettlements, resetLedger, seedDemoData } from '../src/ledger.ts';

test('demo seed is stable and reports four invoices', () => {
  resetLedger(); seedDemoData(); seedDemoData();
  assert.equal(listInvoices().length, 4);
  assert.equal(getSummary().invoiceCount, 4);
});

test('creates invoice and rejects duplicate references', () => {
  resetLedger();
  const input = { reference: 'TEST-001', customer: 'Test Company', description: 'Test service invoice', amount: 1000, currency: 'KES' as const, dueDate: '2026-12-01' };
  assert.equal(createInvoice(input).status, 'open');
  assert.throws(() => createInvoice(input), /already exists/);
});

test('settlement cannot be completed without explicit confirmation', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const s = createSettlement({ invoiceId: invoice.id, amount: 1000, sourceCurrency: 'KES', destinationCurrency: 'KES', destination: '+254700000000', rail: 'mpesa_sandbox', idempotencyKey: 'test-idempotency-01' });
  assert.equal(s.status, 'pending_confirmation');
  assert.throws(() => confirmSettlement(s.id, s.confirmationToken, false), /Explicit confirmation/);
  assert.equal(listSettlements()[0]!.status, 'pending_confirmation');
  assert.throws(() => confirmSettlement(s.id, '00000000-0000-4000-8000-000000000000', true), /Invalid settlement confirmation token/);
});

test('idempotency key returns same settlement rather than duplicating', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const input = { invoiceId: invoice.id, amount: 1000, sourceCurrency: 'KES' as const, destinationCurrency: 'KES' as const, destination: '+254711111111', rail: 'mpesa_sandbox' as const, idempotencyKey: 'repeatable-key-123' };
  const a = createSettlement(input); const b = createSettlement(input);
  assert.equal(a.id, b.id); assert.equal(listSettlements().length, 1);
});

test('confirmed settlement is marked completed in sandbox ledger only', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const s = createSettlement({ invoiceId: invoice.id, amount: invoice.amount, sourceCurrency: 'KES', destinationCurrency: 'KES', destination: '+254722222222', rail: 'mpesa_sandbox', idempotencyKey: 'confirm-test-123' });
  const completed = confirmSettlement(s.id, s.confirmationToken, true);
  assert.equal(completed.status, 'completed');
  assert.match(completed.note, /no funds moved/i);
  assert.equal(listInvoices().find(i => i.id === invoice.id)!.status, 'settled');
});

test('FX estimates are labelled indicative and reject invalid amounts', () => {
  const quote = estimateConversion(1295, 'KES', 'USD');
  assert.equal(quote.outputAmount, 10);
  assert.match(quote.rateLabel, /Illustrative/);
  assert.throws(() => estimateConversion(0, 'KES', 'USD'), /positive/);
});

test('partial settlement keeps invoice partially settled', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const s = createSettlement({ invoiceId: invoice.id, amount: invoice.amount / 2, sourceCurrency: 'KES', destinationCurrency: 'KES', destination: '+254733333333', rail: 'bank_sandbox', idempotencyKey: 'partial-test-123' });
  confirmSettlement(s.id, s.confirmationToken, true);
  assert.equal(listInvoices().find(i => i.id === invoice.id)!.status, 'partially_settled');
});

test('settlement rejects overpayment and invalid destination', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const base = { invoiceId: invoice.id, sourceCurrency: 'KES' as const, destinationCurrency: 'KES' as const, rail: 'mpesa_sandbox' as const, idempotencyKey: 'invalid-test-123' };
  assert.throws(() => createSettlement({ ...base, amount: invoice.amount + 1, destination: '+254700000000' }), /cannot exceed/);
  assert.throws(() => createSettlement({ ...base, amount: 100, destination: 'abc' }), /Destination/);
});


test('settlement reservations prevent exceeding remaining invoice balance', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const base = { invoiceId: invoice.id, sourceCurrency: 'KES' as const, destinationCurrency: 'KES' as const, destination: '+254744444444', rail: 'mpesa_sandbox' as const };
  createSettlement({ ...base, amount: invoice.amount / 2, idempotencyKey: 'reserve-one-123' });
  assert.throws(() => createSettlement({ ...base, amount: invoice.amount / 2 + 1, idempotencyKey: 'reserve-two-123' }), /remaining invoice balance/);
});

test('idempotency key cannot be reused for a different request', () => {
  resetLedger(); seedDemoData();
  const invoice = listInvoices()[0]!;
  const base = { invoiceId: invoice.id, sourceCurrency: 'KES' as const, destinationCurrency: 'KES' as const, destination: '+254755555555', rail: 'mpesa_sandbox' as const, idempotencyKey: 'idempotency-mismatch-1' };
  createSettlement({ ...base, amount: 500 });
  assert.throws(() => createSettlement({ ...base, amount: 600 }), /different settlement request/);
});
