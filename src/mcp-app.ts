import { App } from '@modelcontextprotocol/ext-apps';
import './style.css';

type Currency = 'KES' | 'USD' | 'USDC';
type Invoice = {
  id: string;
  reference: string;
  customer: string;
  description: string;
  amount: number;
  currency: Currency;
  dueDate: string;
  status: string;
  createdAt?: string;
};
type Settlement = {
  id: string;
  invoiceId: string;
  amount: number;
  sourceCurrency: Currency;
  destinationCurrency: Currency;
  destination: string;
  rail: string;
  status: string;
  createdAt: string;
  note: string;
  confirmationToken?: string;
};
type Data = {
  summary: {
    invoiceCount: number;
    openCount: number;
    settlementCount: number;
    completedCount: number;
    pendingCount: number;
    totalKES: number;
    totalUSD: number;
    sandbox: boolean;
  };
  invoices: Invoice[];
  settlements: Settlement[];
  mode: string;
};
type Page =
  | 'dashboard'
  | 'invoices'
  | 'settlements'
  | 'beneficiaries'
  | 'payouts'
  | 'accounts'
  | 'conversions'
  | 'reports'
  | 'counterparties'
  | 'api'
  | 'settings';
type Beneficiary = { name: string; country: string; rail: string; destination: string };

const app = new App({ name: 'M-Ledger Workspace', version: '0.1.0' });
const root = document.querySelector<HTMLDivElement>('#app')!;
const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'invoices', label: 'Invoices', icon: '▤' },
  { id: 'settlements', label: 'Settlements', icon: '⇄' },
  { id: 'beneficiaries', label: 'Beneficiaries', icon: '♙' },
  { id: 'payouts', label: 'Payouts', icon: '↗' },
  { id: 'accounts', label: 'Accounts', icon: '▣' },
  { id: 'conversions', label: 'Conversions', icon: '⇅' },
  { id: 'reports', label: 'Reports', icon: '▥' },
  { id: 'counterparties', label: 'Counterparties', icon: '♧' },
  { id: 'api', label: 'API & MCP', icon: '⌘' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];
const sample: Data = {
  mode: 'SANDBOX',
  summary: {
    invoiceCount: 4, openCount: 4, settlementCount: 0, completedCount: 0,
    pendingCount: 0, totalKES: 343000, totalUSD: 5050, sandbox: true,
  },
  invoices: [
    { id: 'demo-1', reference: 'ML-2026-001', customer: 'Kibo Logistics Ltd', description: 'Regional freight services · Kampala', amount: 245000, currency: 'KES', dueDate: '2026-11-24', status: 'open' },
    { id: 'demo-2', reference: 'ML-2026-002', customer: 'Nairobi Digital Studio', description: 'Product design retainer · Kigali', amount: 1850, currency: 'USD', dueDate: '2026-11-28', status: 'open' },
    { id: 'demo-3', reference: 'ML-2026-003', customer: 'Lakeview Supplies', description: 'Wholesale inventory · Dar es Salaam', amount: 98000, currency: 'KES', dueDate: '2026-12-02', status: 'open' },
    { id: 'demo-4', reference: 'ML-2026-004', customer: 'Amani Exports', description: 'Agricultural exports · Dubai', amount: 3200, currency: 'USDC', dueDate: '2026-12-05', status: 'open' },
  ],
  settlements: [],
};

let storageWarning = '';
function readLocalData(): Data {
  try {
    const stored = localStorage.getItem('mledger.preview-ledger');
    if (!stored) return structuredClone(sample);
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'invoices' in parsed
      && 'settlements' in parsed
      && Array.isArray(parsed.invoices)
      && Array.isArray(parsed.settlements)
    ) {
      return parsed as Data;
    }
    if (stored) {
      localStorage.removeItem('mledger.preview-ledger');
      storageWarning = 'Saved preview data was invalid and has been reset to the sample ledger.';
    }
  } catch (error) {
    storageWarning = error instanceof Error
      ? `Saved preview data could not be loaded: ${error.message}`
      : 'Saved preview data could not be loaded.';
  }
  return structuredClone(sample);
}

let data: Data = readLocalData();
let busy = false;
let notice = storageWarning;
let activePage: Page = 'dashboard';
let connection: 'connected' | 'preview' | 'offline' = 'preview';
let invoiceSearch = '';
let invoiceStatus = 'all';
let settlementStatus = 'all';
let dashboardRange = '30';
let conversionResult = '';
const money = (amount: number, currency: Currency | string) => {
  const iso = currency === 'USDC' ? 'USD' : currency;
  const formatted = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: iso,
    maximumFractionDigits: currency === 'KES' ? 0 : 2,
  }).format(amount);
  return currency === 'USDC' ? `${formatted} USDC` : formatted;
};
const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));
const shortDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? safe(value)
    : new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
};
const pageTitle = (page: Page) => pages.find(item => item.id === page)?.label ?? 'Dashboard';
const parseResult = (result: any): any => {
  const raw = result?.structuredContent ?? result?.content?.find((item: any) => item.type === 'text')?.text;
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
};

function recalculateLocalSummary() {
  const remaining = (invoice: Invoice) => invoice.amount - data.settlements
    .filter(item => item.invoiceId === invoice.id && item.status === 'completed')
    .reduce((sum, item) => sum + item.amount, 0);
  data.summary = {
    invoiceCount: data.invoices.length,
    openCount: data.invoices.filter(invoice => invoice.status !== 'settled').length,
    settlementCount: data.settlements.length,
    completedCount: data.settlements.filter(item => item.status === 'completed').length,
    pendingCount: data.settlements.filter(item => item.status === 'pending_confirmation' || item.status === 'processing').length,
    totalKES: data.invoices.filter(invoice => invoice.currency === 'KES')
      .reduce((sum, invoice) => sum + Math.max(0, remaining(invoice)), 0),
    totalUSD: data.invoices.filter(invoice => invoice.currency !== 'KES')
      .reduce((sum, invoice) => sum + Math.max(0, remaining(invoice)), 0),
    sandbox: true,
  };
}
function saveLocalData() {
  recalculateLocalSummary();
  localStorage.setItem('mledger.preview-ledger', JSON.stringify(data));
}
function validCurrency(value: unknown): value is Currency {
  return value === 'KES' || value === 'USD' || value === 'USDC';
}
function localTool(name: string, args: Record<string, unknown>) {
  let result: Record<string, any>;
  if (name === 'mledger_create_invoice') {
    const reference = String(args.reference ?? '').trim();
    const customer = String(args.customer ?? '').trim();
    const description = String(args.description ?? '').trim();
    const amount = Number(args.amount);
    const currency = args.currency;
    const dueDate = String(args.dueDate ?? '');
    if (reference.length < 3 || reference.length > 40) throw new Error('Invoice reference must contain 3–40 characters.');
    if (data.invoices.some(invoice => invoice.reference.toLowerCase() === reference.toLowerCase())) throw new Error('Invoice reference already exists.');
    if (customer.length < 2 || customer.length > 100) throw new Error('Customer name must contain 2–100 characters.');
    if (description.length < 3 || description.length > 180) throw new Error('Description must contain 3–180 characters.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('Amount must be greater than zero and within the supported limit.');
    if (!validCurrency(currency)) throw new Error('Choose a supported currency.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00`))) throw new Error('Choose a valid due date.');
    const invoice: Invoice = {
      id: crypto.randomUUID(), reference, customer, description, amount, currency, dueDate,
      status: 'open', createdAt: new Date().toISOString(),
    };
    data.invoices.unshift(invoice);
    saveLocalData();
    result = { invoice, sandbox: true };
  } else if (name === 'mledger_request_settlement') {
    const invoice = data.invoices.find(item => item.id === args.invoiceId);
    if (!invoice) throw new Error('Invoice not found.');
    const amount = Number(args.amount);
    const reserved = data.settlements.filter(item => item.invoiceId === invoice.id && item.status !== 'failed')
      .reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > invoice.amount - reserved) throw new Error('Settlement amount must be positive and cannot exceed the remaining invoice balance.');
    if (args.sourceCurrency !== invoice.currency) throw new Error('Settlement source currency must match the invoice currency.');
    const destination = String(args.destination ?? '').trim();
    if (destination.length < 5 || destination.length > 120) throw new Error('Destination must contain 5–120 characters.');
    const rails: Record<string, string> = {
      mpesa_sandbox: 'M-Pesa sandbox',
      bank_sandbox: 'Bank sandbox',
      stablecoin_sandbox: 'Stablecoin sandbox',
    };
    if (typeof args.rail !== 'string' || !rails[args.rail]) throw new Error('Choose a supported sandbox settlement rail.');
    const settlement: Settlement = {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      amount: Math.round(amount * 100) / 100,
      sourceCurrency: invoice.currency,
      destinationCurrency: validCurrency(args.destinationCurrency) ? args.destinationCurrency : 'KES',
      destination,
      rail: args.rail,
      status: 'pending_confirmation',
      createdAt: new Date().toISOString(),
      note: 'Sandbox only. No funds have moved.',
      confirmationToken: crypto.randomUUID(),
    };
    data.settlements.unshift(settlement);
    saveLocalData();
    result = { settlement, sandbox: true };
  } else if (name === 'mledger_get_confirmation_challenge') {
    const settlement = data.settlements.find(item => item.id === args.settlementId && item.status === 'pending_confirmation');
    if (!settlement?.confirmationToken) throw new Error('No pending settlement found.');
    result = { settlementId: settlement.id, confirmationToken: settlement.confirmationToken };
  } else if (name === 'mledger_confirm_settlement') {
    const settlement = data.settlements.find(item => item.id === args.settlementId);
    if (!settlement) throw new Error('Settlement not found.');
    if (settlement.status === 'completed') {
      result = { settlement, sandbox: true };
    } else {
      if (settlement.status !== 'pending_confirmation') throw new Error('Settlement is no longer pending confirmation.');
      if (args.confirmed !== true) throw new Error('Explicit confirmation is required.');
      if (!settlement.confirmationToken || args.confirmationToken !== settlement.confirmationToken) throw new Error('Invalid settlement confirmation token.');
      settlement.status = 'completed';
      settlement.note = 'Sandbox settlement completed. This is a simulated ledger entry; no funds moved.';
      const invoice = data.invoices.find(item => item.id === settlement.invoiceId);
      if (invoice) {
        const total = data.settlements.filter(item => item.invoiceId === invoice.id && item.status === 'completed')
          .reduce((sum, item) => sum + item.amount, 0);
        invoice.status = total >= invoice.amount ? 'settled' : 'partially_settled';
      }
      saveLocalData();
      result = { settlement, sandbox: true };
    }
  } else if (name === 'mledger_estimate_fx') {
    const amount = Number(args.amount);
    const from = args.from;
    const to = args.to;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('Amount must be positive and within the supported limit.');
    if (!validCurrency(from) || !validCurrency(to)) throw new Error('Choose supported currencies.');
    const kesPerUsd = 129.5;
    const usd = from === 'KES' ? amount / kesPerUsd : amount;
    const outputAmount = to === 'KES' ? usd * kesPerUsd : usd;
    result = {
      inputAmount: Math.round(amount * 100) / 100,
      from,
      outputAmount: Math.round(outputAmount * 100) / 100,
      to,
      rateLabel: 'Illustrative demo rate · not executable',
      disclaimer: 'Indicative only. Confirm live rates and fees with your regulated provider.',
    };
  } else {
    throw new Error(`The ${name} operation is unavailable in the static preview.`);
  }
  return {
    structuredContent: result,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

async function refresh() {
  if (connection !== 'connected') return;
  try {
    const response = await app.callServerTool({ name: 'mledger_dashboard', arguments: {} });
    const next = parseResult(response);
    if (next?.summary && Array.isArray(next.invoices) && Array.isArray(next.settlements)) data = next as Data;
  } catch {
    // The local preview intentionally uses sample data when no MCP host is connected.
  }
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  if (busy) return null;
  const modalOpen = Boolean(root.querySelector('#modal-backdrop'));
  busy = true;
  notice = '';
  if (!modalOpen) render();
  try {
    const response = connection === 'connected'
      ? await app.callServerTool({ name, arguments: args })
      : localTool(name, args);
    const parsed = parseResult(response);
    if (!parsed) throw new Error('The server returned an unreadable response.');
    if (parsed.error) {
      notice = String(parsed.error);
      return null;
    }
    if (parsed.summary && Array.isArray(parsed.invoices) && Array.isArray(parsed.settlements)) {
      data = parsed as Data;
    } else if (parsed.invoice) {
      notice = `Invoice ${parsed.invoice.reference} created.`;
    } else if (parsed.settlement) {
      notice = parsed.settlement.note ?? `Settlement ${parsed.settlement.id} updated.`;
    } else if (parsed.outputAmount !== undefined) {
      conversionResult = `${money(parsed.inputAmount, parsed.from)} ≈ ${money(parsed.outputAmount, parsed.to)}. ${parsed.rateLabel}`;
    }
    await refresh();
    return parsed;
  } catch (error) {
    notice = error instanceof Error ? error.message : 'The server could not complete this request. Try again.';
    return null;
  } finally {
    busy = false;
    if (root.querySelector('#modal-backdrop')) {
      if (notice) {
        let message = root.querySelector<HTMLElement>('.modal-notice');
        if (!message) {
          message = document.createElement('div');
          message.className = 'modal-notice';
          message.setAttribute('role', 'status');
          root.querySelector('.modal form')?.prepend(message);
        }
        if (message) message.textContent = notice;
      }
    } else {
      render();
    }
  }
}

function badge(status: string) {
  return `<span class="status ${safe(status)}">${safe(status.replaceAll('_', ' '))}</span>`;
}
function button(label: string, action: string, secondary = false) {
  return `<button class="${secondary ? 'secondary' : 'primary'}" data-action="${safe(action)}">${safe(label)}</button>`;
}
function panelHeader(title: string, description: string, action = '') {
  return `<div class="panel-head"><div><h3>${safe(title)}</h3><p>${safe(description)}</p></div>${action}</div>`;
}
function shell(content: string) {
  const initials = safe((localStorage.getItem('mledger.org') || 'Acme Imports').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase());
  return `<div class="layout">
    <aside class="sidebar">
      <a class="brand" href="#" data-page="dashboard" aria-label="M-Ledger dashboard">
        <span class="brand-mark">M</span><span class="brand-copy"><b>M-LEDGER</b><small>Cross-border Settlements</small></span>
      </a>
      <nav class="main-nav" aria-label="Main navigation">
        ${pages.map(page => `<button class="nav ${activePage === page.id ? 'selected' : ''}" data-page="${page.id}"><span class="nav-icon">${page.icon}</span><span>${page.label}</span></button>`).join('')}
      </nav>
      <div class="wallet-card"><small>SANDBOX WALLET · ILLUSTRATIVE</small><span class="wallet-currency">◉ USDC</span><strong>${money(12450, 'USDC')}</strong><span>≈ ${money(1612275, 'KES')} · demo</span></div>
      <div class="sidebar-bottom">
        <div class="profile"><span class="profile-avatar">${initials}</span><span><b>${safe(localStorage.getItem('mledger.org') || 'Acme Imports Ltd')}</b><small>admin@acme.co.ke</small></span><button aria-label="Open settings" data-page="settings">⌄</button></div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="title-group"><button class="menu-button" aria-label="Toggle navigation" id="menu-toggle">☰</button><h1>${safe(pageTitle(activePage))}</h1></div>
        <div class="top-actions">
          <span class="sandbox-label">Sandbox Mode <i class="toggle-on"></i></span>
          <button class="icon-button notification-button" aria-label="Notifications" data-action="notifications">♧<i></i></button>
          <button class="workspace-button" data-page="settings">${safe(localStorage.getItem('mledger.org') || 'Acme Imports Ltd')} <span>⌄</span></button>
        </div>
      </header>
      <div class="content">
        ${notice ? `<div class="notice" role="status">${safe(notice)}<button aria-label="Dismiss notification" data-action="dismiss-notice">×</button></div>` : ''}
        ${connection === 'offline' ? '<div class="offline-banner" role="status">MCP server connection lost. Actions may not be available until reconnected.</div>' : ''}
        ${content}
        <footer><span>© 2026 M-Ledger · Sandbox workspace</span><span>No real funds are transferred</span></footer>
      </div>
    </main>
  </div>`;
}

function invoiceBalance(invoice: Invoice) {
  const reserved = data.settlements
    .filter(item => item.invoiceId === invoice.id && item.status !== 'failed')
    .reduce((total, item) => total + item.amount, 0);
  return Math.max(0, invoice.amount - reserved);
}
function invoiceRows(invoices: Invoice[]) {
  if (!invoices.length) return '<tr><td colspan="6"><div class="empty-inline">No invoices match this view.</div></td></tr>';
  return invoices.map(invoice => `<tr>
    <td><b>${safe(invoice.reference)}</b><small>${safe(invoice.description)}</small></td>
    <td>${safe(invoice.customer)}</td><td class="amount">${money(invoice.amount, invoice.currency)}</td>
    <td>${shortDate(invoice.dueDate)}</td><td>${badge(invoice.status)}</td>
    <td><button class="text-action" data-settle="${safe(invoice.id)}" ${connection === 'connected' && invoice.id.startsWith('demo-') || invoiceBalance(invoice) <= 0 ? 'disabled title="This invoice has no available settlement balance"' : ''}>Request payout →</button></td>
  </tr>`).join('');
}
function invoiceTable(invoices: Invoice[], includeFilters = false) {
  return `<section class="panel">
    ${panelHeader('Invoice register', `${invoices.length} invoices in this workspace`, '<button class="primary small" data-action="new-invoice">＋ New invoice</button>')}
    ${includeFilters ? `<div class="table-toolbar"><input type="search" id="invoice-search" placeholder="Search invoice or counterparty" value="${safe(invoiceSearch)}"><select id="invoice-status"><option value="all">All statuses</option><option value="open">Open</option><option value="partially_settled">Partially settled</option><option value="settled">Settled</option></select></div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>INVOICE</th><th>COUNTERPARTY</th><th>AMOUNT</th><th>DUE DATE</th><th>STATUS</th><th></th></tr></thead><tbody>${invoiceRows(invoices)}</tbody></table></div>
  </section>`;
}

function totalSettled(currency: Currency) {
  return data.settlements.filter(item => item.status === 'completed' && item.sourceCurrency === currency).reduce((sum, item) => sum + item.amount, 0);
}
function inDashboardRange(date?: string) {
  if (dashboardRange === 'all' || !date) return true;
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) || timestamp >= Date.now() - Number(dashboardRange) * 24 * 60 * 60 * 1000;
}
function dashboardInvoices() {
  return data.invoices.filter(invoice => inDashboardRange(invoice.createdAt));
}
function dashboardSettlements() {
  return data.settlements.filter(item => inDashboardRange(item.createdAt));
}
function dashboardSettled(currency: Currency) {
  return dashboardSettlements().filter(item => item.status === 'completed' && item.sourceCurrency === currency)
    .reduce((sum, item) => sum + item.amount, 0);
}
function chartPanel() {
  const rows = dashboardInvoices().slice(0, 6);
  const values = rows.map(item => item.currency === 'KES' ? item.amount / 1000 : item.amount * 129.5 / 1000);
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = rows.length > 1 ? 12 + index * (276 / (rows.length - 1)) : 150;
    const y = 124 - (value / max) * 90;
    return `${x},${y}`;
  }).join(' ');
  const polygon = values.length ? `12,130 ${points} 288,130` : '12,130 288,130';
  return `<article class="panel chart-panel">${panelHeader('Invoice value by record', 'KES equivalent · current dataset')}
    <div class="chart-area"><div class="chart-labels"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div>
    <svg viewBox="0 0 300 145" role="img" aria-label="Invoice values by record in KES equivalent">
      <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#20b263" stop-opacity=".25"/><stop offset="1" stop-color="#20b263" stop-opacity=".02"/></linearGradient></defs>
      <path class="chart-grid" d="M12 34H288 M12 64H288 M12 94H288 M12 124H288"/>
      <polygon points="${polygon}" fill="url(#chartFill)"/><polyline points="${points || '12,124 288,124'}" fill="none" stroke="#1caf5c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${rows.map((_, index) => {
        const x = rows.length > 1 ? 12 + index * (276 / (rows.length - 1)) : 150;
        const y = 124 - (values[index]! / max) * 90;
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="#1caf5c" stroke-width="2"/>`;
      }).join('')}
    </svg></div>
    <div class="chart-xlabels">${rows.map(item => `<span>${safe(item.reference.slice(-3))}</span>`).join('') || '<span>No invoice activity</span>'}</div>
    <div class="chart-legend"><i></i> Invoice value (KES equivalent)</div>
  </article>`;
}
function methodsPanel() {
  const methods = [
    { key: 'mpesa', label: 'M-Pesa', color: '#16b75f', match: 'mpesa' },
    { key: 'bank', label: 'Bank transfer', color: '#4b98ee', match: 'bank' },
    { key: 'chain', label: 'USDC (On-chain)', color: '#9472ed', match: 'stablecoin' },
  ];
  const counts = methods.map(method => dashboardSettlements().filter(item => item.rail.includes(method.match)).length);
  const total = counts.reduce((sum, value) => sum + value, 0);
  let offset = 0;
  const segments = counts.map((count, index) => {
    const portion = total ? (count / total) * 100 : 0;
    const start = offset;
    offset += portion;
    return `${methods[index]!.color} ${start}% ${offset}%`;
  });
  const donut = total ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(#e9eef0 0 100%)';
  return `<article class="panel method-panel">${panelHeader('Settlement methods', 'Distribution by sandbox rail')}
    <div class="method-content"><div class="donut" style="--donut:${donut}"><div><strong>${total}</strong><small>Total</small></div></div>
    <div class="method-legend">${methods.map((method, index) => `<div><i style="background:${method.color}"></i><span>${method.label}<small>${counts[index]} ${counts[index] === 1 ? 'transaction' : 'transactions'}</small></span></div>`).join('')}</div></div>
  </article>`;
}
function corridorsPanel() {
  const currencies: Currency[] = ['KES', 'USD', 'USDC'];
  const rows = currencies.map(currency => {
    const openInvoices = data.invoices.filter(invoice => invoice.currency === currency && invoiceBalance(invoice) > 0);
    return {
      currency,
      amount: openInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0),
      count: openInvoices.length,
    };
  });
  return `<article class="panel corridors-panel">${panelHeader('Invoice exposure by currency', 'Open invoice balances · sandbox')}
    <div class="corridor-list">${rows.map(row => `<div class="corridor-row"><span class="corridor-flags">${row.currency}</span>
      <span class="corridor-name">${row.count} ${row.count === 1 ? 'open invoice' : 'open invoices'}<small>Current balance</small></span>
      <b class="corridor-amount">${money(row.amount, row.currency)}</b></div>`).join('')}
    </div><button class="view-all" data-page="settlements">View settlements <span>→</span></button>
  </article>`;
}
function recentActivity() {
  const settlements = dashboardSettlements().slice(0, 4);
  return `<article class="panel recent-panel">${panelHeader('Recent settlements', 'Latest payout instructions', '<button class="text-action" data-page="settlements">View all</button>')}
    ${settlements.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>COUNTERPARTY</th><th>METHOD</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>${settlements.map(item => {
      const invoice = data.invoices.find(candidate => candidate.id === item.invoiceId);
      return `<tr><td><b>${safe(item.id.slice(0, 10))}</b></td><td>${safe(invoice?.customer ?? '—')}</td><td><span class="rail-chip">${safe(item.rail.replaceAll('_sandbox', '').replaceAll('_', ' '))}</span></td><td class="amount">${money(item.amount, item.sourceCurrency)}</td><td>${badge(item.status)}</td><td>${shortDate(item.createdAt)}</td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty-inline">No settlement instructions yet. Request a payout from an open invoice to see activity here.</div>`}
  </article>`;
}
function activityFeed() {
  const items = [
    ...dashboardSettlements().map(item => ({
      icon: item.status === 'completed' ? '✓' : '↗',
      title: item.status === 'completed' ? 'Settlement completed' : 'Settlement awaiting approval',
      description: `${money(item.amount, item.sourceCurrency)} · ${item.rail.replaceAll('_', ' ')}`,
      date: item.createdAt,
      good: item.status === 'completed',
    })),
    ...dashboardInvoices().slice(0, 4).map(invoice => ({
      icon: '▤', title: `Invoice ${invoice.reference} created`,
      description: `${safe(invoice.customer)} · ${money(invoice.amount, invoice.currency)}`,
      date: invoice.createdAt ?? invoice.dueDate, good: true,
    })),
  ].slice(0, 5);
  return `<article class="panel activity-panel">${panelHeader('Activity feed', 'Updates from your workspace', '<button class="text-action" data-page="reports">View all</button>')}
    <div class="activity-list">${items.map(item => `<div class="activity-item"><span class="activity-icon ${item.good ? 'success' : 'pending'}">${item.icon}</span><div><b>${safe(item.title)}</b><small>${safe(item.description)}</small></div><time>${shortDate(item.date)}</time></div>`).join('')}</div>
  </article>`;
}
function quickTools() {
  return `<article class="panel quick-panel">${panelHeader('Quick actions', 'Common workspace tasks')}
    <div class="quick-actions">${button('＋ New invoice', 'new-invoice')}<button class="secondary" data-page="beneficiaries">＋ Add beneficiary</button><button class="secondary" data-action="quick-payout">↗ Request settlement</button><button class="secondary" data-page="conversions">⇅ Convert currency</button></div>
  </article>`;
}
function dashboardPage() {
  const greetingName = (localStorage.getItem('mledger.org') || 'Acme Imports').split(' ')[0];
  return `<div class="dashboard-welcome"><div><h2>Good morning, ${safe(greetingName)}! <span>👋</span></h2><p>Here’s what’s happening with your settlements today.</p></div>
    <select class="date-filter" id="dashboard-range" aria-label="Dashboard date range"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></div>
    <section class="metrics" aria-label="Key metrics">
      <article class="metric"><div class="metric-icon green">↗</div><div><small>Total Settled (KES)</small><strong>${money(dashboardSettled('KES'), 'KES')}</strong><span class="metric-note positive">● ${dashboardSettlements().filter(item => item.status === 'completed').length} completed</span></div></article>
      <article class="metric"><div class="metric-icon blue">$</div><div><small>Total Settled (USD)</small><strong>${money(dashboardSettled('USD') + dashboardSettled('USDC'), 'USD')}</strong><span class="metric-note positive">● ${dashboardSettlements().filter(item => item.status === 'completed').length} completed</span></div></article>
      <article class="metric"><div class="metric-icon purple">▣</div><div><small>Total Fees (KES)</small><strong>${money(0, 'KES')}</strong><span class="metric-note neutral">— Sandbox fees not charged</span></div></article>
      <article class="metric"><div class="metric-icon orange">⇄</div><div><small>Total Transactions</small><strong>${dashboardSettlements().length}</strong><span class="metric-note neutral">● ${dashboardSettlements().filter(item => item.status === 'pending_confirmation' || item.status === 'processing').length} pending</span></div></article>
    </section>
    <section class="dashboard-grid top-widgets">${chartPanel()}${methodsPanel()}${corridorsPanel()}</section>
    <section class="dashboard-grid mid-widgets">${recentActivity()}${activityFeed()}</section>
    <section class="dashboard-grid bottom-widgets">
      <article class="panel exchange-panel">${panelHeader('Exchange rates · demo', 'Illustrative only · not live')}
        <div class="rate-row"><span>1 USD ≈ 129.50 KES</span><b>DEMO</b></div><div class="rate-row"><span>1 USDC ≈ 129.50 KES</span><b>DEMO</b></div><small>No live rate provider is connected.</small>
      </article>
      <article class="panel network-panel">${panelHeader('Network status', 'Sandbox integrations')}
        ${['M-Pesa sandbox', 'Bank transfer', 'USDC sandbox'].map(label => `<div class="network-row"><span>${label}</span><b><i></i> Sandbox ready</b></div>`).join('')}
      </article>
      ${quickTools()}
      <article class="panel help-panel">${panelHeader('Need help?', 'Your sandbox workspace is ready to explore')}
        <p>Review the guides for creating invoices and confirming sandbox settlements.</p><div class="help-actions"><button class="secondary" data-page="api">Help center</button><button class="secondary" data-page="settings">Contact support</button></div>
      </article>
    </section>
    <section class="dashboard-invoices">${invoiceTable(data.invoices.slice(0, 5))}</section>`;
}

function invoicesPage() {
  const term = invoiceSearch.trim().toLowerCase();
  const filtered = data.invoices.filter(invoice => {
    const matchesText = !term || [invoice.reference, invoice.customer, invoice.description].some(value => value.toLowerCase().includes(term));
    const matchesStatus = invoiceStatus === 'all' || invoice.status === invoiceStatus;
    return matchesText && matchesStatus;
  });
  return invoiceTable(filtered, true);
}
function settlementRows(items: Settlement[]) {
  if (!items.length) return '<tr><td colspan="7"><div class="empty-inline">No settlement instructions match this view.</div></td></tr>';
  return items.map(item => {
    const invoice = data.invoices.find(candidate => candidate.id === item.invoiceId);
    return `<tr><td><b>${safe(item.id.slice(0, 10))}</b><small>${shortDate(item.createdAt)}</small></td>
      <td>${safe(invoice?.customer ?? '—')}</td><td>${safe(item.destination)}</td><td class="amount">${money(item.amount, item.sourceCurrency)}</td>
      <td>${safe(item.rail.replaceAll('_', ' '))}</td><td>${badge(item.status)}</td>
      <td>${item.status === 'pending_confirmation' ? `<button class="text-action" data-confirm="${safe(item.id)}">Review & confirm →</button>` : '—'}</td></tr>`;
  }).join('');
}
function settlementsPage(payouts = false) {
  const items = data.settlements.filter(item => settlementStatus === 'all' || item.status === settlementStatus);
  return `<section class="panel">
    ${panelHeader(payouts ? 'Payout activity' : 'Settlement instructions', payouts ? 'Track sandbox disbursements and their statuses' : 'Review payout instructions, recipients and confirmation status', '<button class="primary small" data-action="quick-payout">＋ Request payout</button>')}
    <div class="table-toolbar"><label>Status <select id="settlement-status"><option value="all">All statuses</option><option value="pending_confirmation">Pending approval</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label></div>
    ${items.length ? `<div class="table-wrap"><table><thead><tr><th>SETTLEMENT</th><th>COUNTERPARTY</th><th>DESTINATION</th><th>AMOUNT</th><th>METHOD</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${settlementRows(items)}</tbody></table></div>` : `<div class="empty"><span>⇄</span><h4>${settlementStatus === 'all' ? 'No payouts yet' : 'No matching payouts'}</h4><p>Choose an open invoice to create a sandbox settlement instruction. No real funds will move.</p><button class="secondary" data-page="invoices">Browse invoices</button></div>`}
  </section>`;
}

function getBeneficiaries(): Beneficiary[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('mledger.beneficiaries') ?? '[]');
    return Array.isArray(saved) ? saved as Beneficiary[] : [];
  } catch {
    return [];
  }
}
function beneficiariesPage() {
  const stored = getBeneficiaries();
  const derived = [...new Set(data.invoices.map(item => item.customer))].map(name => ({
    name, country: 'East Africa', rail: 'Not set', destination: 'Add payout details to enable a payout',
  }));
  const records = [...stored, ...derived.filter(item => !stored.some(saved => saved.name === item.name))];
  return `<section class="panel">${panelHeader('Beneficiary directory', `${records.length} saved or invoice-linked counterparties`, '<button class="primary small" data-action="new-beneficiary">＋ Add beneficiary</button>')}
    ${records.length ? `<div class="beneficiary-grid">${records.map((item, index) => `<article class="beneficiary-card"><span class="beneficiary-avatar">${safe(item.name.slice(0, 1).toUpperCase())}</span><div class="beneficiary-info"><h3>${safe(item.name)}</h3><p>${safe(item.country)} · ${safe(item.rail)}</p><small>${safe(item.destination)}</small></div>${index < stored.length ? '<span class="status completed">SAVED</span>' : '<span class="status">INVOICE LINKED</span>'}</article>`).join('')}</div>` : '<div class="empty-inline">Add your first beneficiary to keep payout details organized.</div>'}
  </section><div class="notice info-notice">Beneficiaries are stored locally in this browser preview. Saved details do not initiate payments.</div>`;
}
function accountsPage() {
  const currencies: Currency[] = ['KES', 'USD', 'USDC'];
  return `<div class="page-intro"><h2>Sandbox accounts</h2><p>Balances are illustrative and are not connected to a bank, wallet, or payment provider.</p></div>
    <section class="account-grid">${currencies.map((currency, index) => {
      const open = data.invoices.filter(invoice => invoice.currency === currency).reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
      const settled = totalSettled(currency);
      return `<article class="panel account-card"><div class="account-heading"><span class="metric-icon ${['green', 'blue', 'purple'][index]}">${['₭', '$', '◈'][index]}</span><span class="status">SANDBOX</span></div><small>${currency} LEDGER</small><strong>${money(open, currency)}</strong><p>Open receivables</p><div class="account-divider"></div><div class="account-detail"><span>Settled in sandbox</span><b>${money(settled, currency)}</b></div><div class="account-detail"><span>Linked invoices</span><b>${data.invoices.filter(invoice => invoice.currency === currency).length}</b></div><button class="secondary full" data-page="invoices">View invoices</button></article>`;
    }).join('')}</section>
    <section class="panel">${panelHeader('Connected services', 'Provider status for this sandbox')}
      ${['M-Pesa', 'Regional bank transfer', 'USDC network'].map((name, index) => `<div class="service-row"><span class="service-icon">${['M', '▤', '◈'][index]}</span><div><b>${name}</b><small>Demo adapter · no live credentials configured</small></div><span class="status completed">AVAILABLE IN SANDBOX</span></div>`).join('')}
    </section>`;
}
function conversionForm() {
  return `<section class="panel conversion-card">${panelHeader('Currency converter', 'Indicative demonstration rates · not a quote')}
    <form id="conversion-form" class="conversion-form"><label>Amount to convert<input type="number" name="amount" min="0.01" step="0.01" value="1000" required></label>
      <div class="conversion-pair"><label>From<select name="from"><option>KES</option><option>USD</option><option>USDC</option></select></label><span>⇄</span><label>To<select name="to"><option>USD</option><option>KES</option><option>USDC</option></select></label></div>
      <button class="primary" type="submit" ${busy ? 'disabled' : ''}>Calculate estimate</button>
      ${conversionResult ? `<div class="conversion-result" role="status">${safe(conversionResult)}</div>` : ''}
      <p class="fineprint">Illustrative demo rates only. No live FX provider is connected and this estimate cannot be executed.</p>
    </form>
  </section><div class="page-aside">${panelHeader('Supported currencies', 'Sandbox ledger currencies')}<div class="currency-list"><span>KES <small>Kenyan Shilling</small></span><span>USD <small>United States Dollar</small></span><span>USDC <small>USD Coin · sandbox only</small></span></div></div>`;
}
function reportsPage() {
  const settled = data.settlements.filter(item => item.status === 'completed');
  return `<section class="report-header">${panelHeader('Workspace reports', 'Export a snapshot of your current sandbox ledger', '<button class="primary small" data-action="export-report">↓ Export CSV</button>')}</section>
    <section class="report-grid"><article class="panel report-card"><small>INVOICES</small><strong>${data.summary.invoiceCount}</strong><span>Across ${new Set(data.invoices.map(item => item.currency)).size} currencies</span></article>
      <article class="panel report-card"><small>OPEN INVOICES</small><strong>${data.summary.openCount}</strong><span>Balances remain grouped by invoice currency</span></article>
      <article class="panel report-card"><small>SETTLEMENTS</small><strong>${data.summary.settlementCount}</strong><span>${settled.length} completed · ${data.summary.pendingCount} pending</span></article>
      <article class="panel report-card"><small>FEES</small><strong>${money(0, 'KES')}</strong><span>Not applicable in sandbox</span></article></section>
    <section class="panel">${panelHeader('Recent activity', `${data.settlements.length} settlement records`)}
      ${data.settlements.length ? `<div class="table-wrap"><table><thead><tr><th>REFERENCE</th><th>AMOUNT</th><th>RAIL</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>${data.settlements.map(item => `<tr><td>${safe(item.id.slice(0, 12))}</td><td class="amount">${money(item.amount, item.sourceCurrency)}</td><td>${safe(item.rail.replaceAll('_', ' '))}</td><td>${badge(item.status)}</td><td>${shortDate(item.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-inline">No settlement activity to report yet.</div>'}
    </section>`;
}
function counterpartiesPage() {
  const grouped = new Map<string, Invoice[]>();
  data.invoices.forEach(invoice => grouped.set(invoice.customer, [...(grouped.get(invoice.customer) ?? []), invoice]));
  const rows = [...grouped.entries()];
  return `<section class="panel">${panelHeader('Counterparties', `${rows.length} businesses linked to invoice records`, '<button class="primary small" data-action="new-invoice">＋ New invoice</button>')}
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>BUSINESS</th><th>INVOICES</th><th>OPEN BALANCE</th><th>CURRENCIES</th><th>STATUS</th><th></th></tr></thead><tbody>${rows.map(([name, invoices]) => `<tr><td><b>${safe(name)}</b><small>Invoice-linked business</small></td><td>${invoices.length}</td><td class="amount">${invoices.map(invoice => money(invoiceBalance(invoice), invoice.currency)).join('<br>')}</td><td>${[...new Set(invoices.map(invoice => invoice.currency))].join(', ')}</td><td>${badge(invoices.every(invoice => invoice.status === 'settled') ? 'settled' : 'open')}</td><td><button class="text-action" data-page="invoices">View invoices →</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-inline">Counterparties will appear here when you add invoices.</div>'}
  </section><div class="notice info-notice">Counterparty profiles are derived from invoice records. Create an invoice to add a business to this list.</div>`;
}
function apiPage() {
  const endpoint = `${location.origin}/mcp`;
  const tools = ['mledger_dashboard', 'mledger_list_invoices', 'mledger_create_invoice', 'mledger_estimate_fx', 'mledger_request_settlement', 'mledger_list_settlements'];
  return `<div class="page-intro"><h2>API & MCP</h2><p>Connect an MCP-compatible host to the sandbox settlement workspace.</p></div>
    <section class="panel">${panelHeader('MCP endpoint', 'Streamable HTTP · local sandbox', '<button class="secondary small" data-copy="${safe(endpoint)}">Copy URL</button>')}
      <div class="code-block">${safe(endpoint)}</div><div class="api-meta"><span>Connection <b class="${connection === 'connected' ? 'text-green' : ''}">${connection === 'connected' ? 'Connected to MCP host' : connection === 'preview' ? 'Static preview · actions stay in this browser' : 'Disconnected'}</b></span><span>${connection === 'connected' ? `Health check <code>${safe(location.origin)}/health</code>` : 'A separately hosted backend is required for MCP tools.'}</span></div>
    </section>
    <section class="panel">${panelHeader('Available MCP tools', 'Read and write operations when opened in an MCP host')}
      <div class="tool-list">${tools.map(tool => `<div><code>${tool}</code><span>${tool.includes('create') || tool.includes('request') ? 'Sandbox write' : 'Read / estimate'}</span></div>`).join('')}</div>
      <div class="notice info-notice">${connection === 'connected' ? 'Settlement confirmation is gated in the app UI and updates only the sandbox ledger. This server cannot transfer money.' : 'Static preview actions are stored in this browser only. They are not sent to an MCP server and cannot transfer money.'}</div>
    </section>`;
}
function settingsPage() {
  const organization = safe(localStorage.getItem('mledger.org') || 'Acme Imports Ltd');
  const notifications = localStorage.getItem('mledger.notifications') !== 'false';
  return `<section class="panel settings-panel">${panelHeader('Workspace settings', 'Manage local preview preferences')}
    <form id="settings-form" class="settings-form"><label>Organization name<input name="organization" value="${organization}" maxlength="80" required></label>
      <label class="setting-switch"><span><b>Settlement notifications</b><small>Show local activity notices in this workspace.</small></span><input name="notifications" type="checkbox" ${notifications ? 'checked' : ''}></label>
      <div class="setting-readonly"><span>Workspace mode</span><b>Sandbox · no real funds</b></div>      <div class="setting-readonly"><span>Data storage</span><b>${connection === 'connected' ? 'In-memory MCP server' : 'Browser local storage · this device'}</b></div>
      <button class="primary" type="submit">Save settings</button></form>
  </section><div class="notice info-notice">Organization name and notification preference are saved in this browser only. Payment provider credentials are not configured here.</div>`;
}

function contentForPage() {
  switch (activePage) {
    case 'dashboard': return dashboardPage();
    case 'invoices': return invoicesPage();
    case 'settlements': return settlementsPage();
    case 'beneficiaries': return beneficiariesPage();
    case 'payouts': return settlementsPage(true);
    case 'accounts': return accountsPage();
    case 'conversions': return conversionForm();
    case 'reports': return reportsPage();
    case 'counterparties': return counterpartiesPage();
    case 'api': return apiPage();
    case 'settings': return settingsPage();
  }
}

function modal(html: string) {
  root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}<button class="close" data-close aria-label="Close">×</button></section></div>`);
  root.querySelector<HTMLInputElement>('.modal input:not([type=hidden])')?.focus();
  root.querySelectorAll('[data-close]').forEach(element => element.addEventListener('click', closeModal));
  root.querySelector('#modal-backdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
  bindModalForms();
}
function closeModal() {
  root.querySelector('#modal-backdrop')?.remove();
}
function bindModalForms() {
  root.querySelector<HTMLFormElement>('#invoice-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const args = Object.fromEntries(formData) as Record<string, unknown>;
    args.amount = Number(args.amount);
    if (await callTool('mledger_create_invoice', args)) {
      closeModal();
      activePage = 'invoices';
      render();
    }
  });
  root.querySelector<HTMLFormElement>('#settlement-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const args = Object.fromEntries(formData) as Record<string, unknown>;
    args.amount = Number(args.amount);
    args.idempotencyKey = `ui-${crypto.randomUUID()}`;
    if (await callTool('mledger_request_settlement', args)) {
      closeModal();
      activePage = 'settlements';
      render();
    }
  });
  root.querySelector<HTMLFormElement>('#beneficiary-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const beneficiary = Object.fromEntries(formData) as Beneficiary;
    const beneficiaries = getBeneficiaries();
    if (beneficiaries.some(item => item.name.toLowerCase() === beneficiary.name.toLowerCase())) {
      let message = root.querySelector<HTMLElement>('.modal-notice');
      if (!message) {
        message = document.createElement('div');
        message.className = 'modal-notice';
        message.setAttribute('role', 'status');
        root.querySelector('.modal form')?.prepend(message);
      }
      if (message) message.textContent = 'A beneficiary with this name is already saved.';
      return;
    }
    beneficiaries.unshift(beneficiary);
    localStorage.setItem('mledger.beneficiaries', JSON.stringify(beneficiaries));
    closeModal();
    notice = 'Beneficiary saved locally.';
    render();
  });
}
function openInvoiceModal() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  const dueDate = date.toISOString().slice(0, 10);
  modal(`<p class="eyebrow">RECEIVABLES</p><h3 id="modal-title">Create invoice</h3><p class="sub">Add an invoice record to your sandbox workspace.</p>
    <form id="invoice-form"><label>Invoice reference<input name="reference" placeholder="ML-2026-005" required minlength="3" maxlength="40"></label>
    <label>Customer / counterparty<input name="customer" placeholder="Business name" required minlength="2"></label>
    <label>Description<input name="description" placeholder="What is this invoice for?" required minlength="3"></label>
    <div class="form-grid"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Currency<select name="currency"><option>KES</option><option>USD</option><option>USDC</option></select></label></div>
    <label>Due date<input name="dueDate" type="date" value="${dueDate}" required></label><button class="primary full" type="submit">Create invoice</button></form>`);
}
function openSettlementModal(invoice: Invoice) {
  const remaining = invoiceBalance(invoice);
  modal(`<p class="eyebrow">SANDBOX SETTLEMENT</p><h3 id="modal-title">Settle ${safe(invoice.reference)}</h3>
    <p class="sub">Create a settlement instruction. It will remain pending until explicitly confirmed.</p>
    <form id="settlement-form"><input type="hidden" name="invoiceId" value="${safe(invoice.id)}">
      <label>Amount (${safe(invoice.currency)})<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${remaining}" required></label>
      <label>Source currency<select name="sourceCurrency"><option>${safe(invoice.currency)}</option></select></label>
      <label>Destination currency<select name="destinationCurrency"><option>KES</option><option>USD</option><option>USDC</option></select></label>
      <label>Destination phone / account / wallet<input name="destination" placeholder="Test destination only" required minlength="5" maxlength="120"></label>
      <label>Settlement rail<select name="rail"><option value="mpesa_sandbox">M-Pesa sandbox</option><option value="bank_sandbox">Bank sandbox</option><option value="stablecoin_sandbox">Stablecoin sandbox</option></select></label>
      <button class="primary full" type="submit">Create pending instruction</button><p class="fineprint">Sandbox only. This does not initiate an actual payout or blockchain transfer.</p>
    </form>`);
}
function openBeneficiaryModal() {
  modal(`<p class="eyebrow">DIRECTORY</p><h3 id="modal-title">Add beneficiary</h3><p class="sub">Save recipient details locally for reference. This does not enable or initiate a payout.</p>
    <form id="beneficiary-form"><label>Business / recipient name<input name="name" required minlength="2" maxlength="100"></label>
      <label>Country<input name="country" placeholder="Kenya" required maxlength="80"></label>
      <label>Payout method<select name="rail"><option>M-Pesa</option><option>Bank transfer</option><option>USDC wallet</option></select></label>
      <label>Phone / account / wallet<input name="destination" required minlength="5" maxlength="120"></label>
      <button class="primary full" type="submit">Save beneficiary</button></form>`);
}
function confirmationDialog(settlement: Settlement) {
  const invoice = data.invoices.find(item => item.id === settlement.invoiceId);
  modal(`<p class="eyebrow">FINAL REVIEW · SANDBOX</p><h3 id="modal-title">Confirm settlement?</h3>
    <p class="sub">Review the destination and amount before approving this sandbox ledger action.</p>
    <div class="review-list"><div><small>AMOUNT</small><b>${money(settlement.amount, settlement.sourceCurrency)}</b></div>
      <div><small>RECIPIENT</small><b>${safe(settlement.destination)}</b></div><div><small>RAIL</small><b>${safe(settlement.rail.replaceAll('_', ' '))}</b></div>
      <div><small>INVOICE</small><b>${safe(invoice?.reference ?? settlement.id.slice(0, 12))}</b></div></div>
    <div class="confirm-warning">Sandbox only — this updates the demo ledger. No real funds will move.</div>
    <div class="confirm-actions"><button class="secondary" data-close>Cancel</button><button class="primary" id="approve-settlement">Approve sandbox entry</button></div>`);
  root.querySelector<HTMLButtonElement>('#approve-settlement')?.addEventListener('click', async event => {
    const control = event.currentTarget as HTMLButtonElement;
    control.disabled = true;
    control.textContent = 'Confirming…';
    try {
      const challenge = await callTool('mledger_get_confirmation_challenge', { settlementId: settlement.id });
      if (!challenge?.confirmationToken) throw new Error(challenge?.error ?? 'Unable to obtain a valid confirmation challenge.');
      closeModal();
      await callTool('mledger_confirm_settlement', {
        settlementId: settlement.id,
        confirmationToken: challenge.confirmationToken,
        confirmed: true,
      });
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Confirmation failed.';
      render();
    }
  });
}

function exportReport() {
  const rows = [
    ['Type', 'Reference', 'Counterparty', 'Amount', 'Currency', 'Status', 'Date'],
    ...data.invoices.map(invoice => ['Invoice', invoice.reference, invoice.customer, String(invoice.amount), invoice.currency, invoice.status, invoice.dueDate]),
    ...data.settlements.map(item => ['Settlement', item.id, data.invoices.find(invoice => invoice.id === item.invoiceId)?.customer ?? '', String(item.amount), item.sourceCurrency, item.status, item.createdAt]),
  ];
  const csv = rows.map(row => row.map(value => {
    const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'm-ledger-sandbox-report.csv';
  anchor.click();
  URL.revokeObjectURL(url);
  notice = 'Report exported as CSV.';
  render();
}

function render() {
  root.innerHTML = shell(contentForPage());
  root.querySelectorAll<HTMLElement>('[data-page]').forEach(element => element.addEventListener('click', event => {
    event.preventDefault();
    const page = (event.currentTarget as HTMLElement).dataset.page as Page | undefined;
    if (page && pages.some(item => item.id === page)) {
      activePage = page;
      notice = '';
      root.querySelector('.sidebar')?.classList.remove('sidebar-open');
      render();
    }
  }));
  root.querySelectorAll<HTMLElement>('[data-action]').forEach(element => element.addEventListener('click', async event => {
    const action = (event.currentTarget as HTMLElement).dataset.action;
    if (action === 'new-invoice') openInvoiceModal();
    if (action === 'new-beneficiary') openBeneficiaryModal();
    if (action === 'dismiss-notice') { notice = ''; render(); }
    if (action === 'notifications') {
      notice = localStorage.getItem('mledger.notifications') === 'false' ? 'There are no new notifications.' : 'You’re all caught up.';
      render();
    }
    if (action === 'quick-payout') {
      const invoice = data.invoices.find(item => (connection !== 'connected' || !item.id.startsWith('demo-')) && invoiceBalance(item) > 0);
      if (invoice) openSettlementModal(invoice);
      else {
        notice = 'Create an invoice before requesting a sandbox payout.';
        activePage = 'invoices';
        render();
      }
    }
    if (action === 'export-report') exportReport();
  }));
  root.querySelectorAll<HTMLElement>('[data-copy]').forEach(element => element.addEventListener('click', async event => {
    const text = (event.currentTarget as HTMLElement).dataset.copy ?? '';
    try {
      await navigator.clipboard.writeText(text);
      notice = 'Copied to clipboard.';
    } catch {
      notice = `Copy this URL: ${text}`;
    }
    render();
  }));
  root.querySelectorAll<HTMLElement>('[data-settle]').forEach(element => element.addEventListener('click', () => {
    const invoice = data.invoices.find(item => item.id === element.dataset.settle);
    if (invoice && (connection !== 'connected' || !invoice.id.startsWith('demo-'))) openSettlementModal(invoice);
  }));
  root.querySelectorAll<HTMLElement>('[data-confirm]').forEach(element => element.addEventListener('click', () => {
    const settlement = data.settlements.find(item => item.id === element.dataset.confirm);
    if (settlement) confirmationDialog(settlement);
  }));
  root.querySelector('#invoice-search')?.addEventListener('input', event => {
    invoiceSearch = (event.currentTarget as HTMLInputElement).value;
    const cursor = invoiceSearch.length;
    render();
    const input = root.querySelector<HTMLInputElement>('#invoice-search');
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
  });
  const invoiceStatusSelect = root.querySelector<HTMLSelectElement>('#invoice-status');
  if (invoiceStatusSelect) {
    invoiceStatusSelect.value = invoiceStatus;
    invoiceStatusSelect.addEventListener('change', event => {
      invoiceStatus = (event.currentTarget as HTMLSelectElement).value;
      render();
    });
  }
  const settlementStatusSelect = root.querySelector<HTMLSelectElement>('#settlement-status');
  if (settlementStatusSelect) {
    settlementStatusSelect.value = settlementStatus;
    settlementStatusSelect.addEventListener('change', event => {
      settlementStatus = (event.currentTarget as HTMLSelectElement).value;
      render();
    });
  }
  const dashboardRangeSelect = root.querySelector<HTMLSelectElement>('#dashboard-range');
  if (dashboardRangeSelect) {
    dashboardRangeSelect.value = dashboardRange;
    dashboardRangeSelect.addEventListener('change', event => {
      dashboardRange = (event.currentTarget as HTMLSelectElement).value;
      render();
    });
  }
  root.querySelector<HTMLFormElement>('#conversion-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const amount = Number(formData.get('amount'));
    const from = String(formData.get('from'));
    const to = String(formData.get('to'));
    await callTool('mledger_estimate_fx', { amount, from, to });
  });
  root.querySelector<HTMLFormElement>('#settings-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const organization = String(formData.get('organization')).trim();
    if (!organization) {
      notice = 'Organization name cannot be empty.';
      render();
      return;
    }
    localStorage.setItem('mledger.org', organization);
    localStorage.setItem('mledger.notifications', String(formData.has('notifications')));
    notice = 'Workspace settings saved.';
    render();
  });
  root.querySelector('#menu-toggle')?.addEventListener('click', () => {
    root.querySelector('.sidebar')?.classList.toggle('sidebar-open');
  });
}

app.ontoolresult = (result: any) => {
  const next = parseResult(result);
  if (next?.summary && Array.isArray(next.invoices) && Array.isArray(next.settlements)) {
    data = next as Data;
    render();
  }
};
app.onerror = (error: any) => {
  connection = 'offline';
  notice = error?.message ?? 'MCP host connection issue.';
  render();
};

render();
app.connect()
  .then(async () => {
    connection = 'connected';
    await refresh();
    render();
  })
  .catch(() => {
    connection = 'preview';
    notice = notice || 'Static sandbox preview: changes are saved in this browser only.';
    render();
  });
