# M-Ledger — MCP App

M-Ledger is an MCP server plus an interactive MCP Apps workspace for East African B2B invoice tracking and settlement reconciliation. This first vertical slice is a **sandbox ledger**. It does not connect to M-Pesa, a bank, a stablecoin network, or a live FX provider, and it cannot transfer funds.

## Included

- Dashboard with KES and USD/USDC invoice totals.
- Finance workspace navigation for invoices, settlements, beneficiaries, payouts, accounts, conversions, reports, counterparties, API/MCP details and settings.
- Searchable invoice register, local beneficiary directory, indicative currency estimates and CSV ledger reports.
- Invoice creation and invoice register.
- Indicative FX estimator (hard-coded demonstration rate; not a quote).
- Settlement instructions for M-Pesa, bank and stablecoin sandbox rails.
- Explicit confirmation gate and idempotency keys for settlement instructions.
- MCP tools with a useful text/structured response even when the host does not render the UI.
- Streamable HTTP endpoint and optional bearer-token guard.
- A non-custodial Solidity settlement registry that records hashed references and status changes only; it does not transfer tokens or funds.

## Requirements

- Node.js 22+
- npm

## Install and run

```bash
cp .env.example .env
npm install
npm run build
npm start
```

In Windows PowerShell, use `Copy-Item` for the optional environment file and call `npm.cmd` to avoid PowerShell's script-execution policy blocking `npm.ps1`:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run build
npm.cmd start
```

The MCP endpoint defaults to `http://127.0.0.1:3001/mcp`; health check: `http://127.0.0.1:3001/health`.

The current starter exposes Streamable HTTP. A stdio adapter can be added for hosts that launch local MCP processes.
`npm run build` also compiles the Solidity registry and writes its ABI and bytecode to `dist/contracts/MLedgerSettlementRegistry.json`.

## MCP tool contract

| Tool | Purpose | Writes? |
|---|---|---|
| `mledger_dashboard` | Summary, invoices and settlements; opens the UI | No |
| `mledger_list_invoices` | Filter and list invoices | No |
| `mledger_create_invoice` | Create a sandbox invoice record | Yes, local ledger only |
| `mledger_estimate_fx` | Indicative KES/USD/USDC conversion | No |
| `mledger_request_settlement` | Create pending sandbox instruction | Yes, local ledger only |
| `mledger_get_confirmation_challenge` | UI-only: retrieve one-time token after user reviews and approves exact details | Yes, local ledger only |
| `mledger_confirm_settlement` | UI-only: mark sandbox instruction completed after approval and token validation | Yes, local ledger only |
| `mledger_list_settlements` | Filter and list settlement instructions | No |

All writes validate their inputs server-side. The one-time confirmation challenge and `mledger_confirm_settlement` are app-only tools hidden from the model. The UI asks the user to review the exact destination and amount, then retrieves the challenge and confirms. Idempotency keys prevent duplicate settlement records. IDs are generated server-side. This prototype uses in-memory storage and resets on restart.

## Security and production gaps

- Do not expose the demo endpoint publicly without HTTPS, real authentication/authorization, tenant isolation, durable storage, audit logging, rate limits and monitoring.
- Set `MLEDGER_API_TOKEN` (at least 32 characters) to require a shared bearer token for the HTTP endpoint. Binding to `0.0.0.0` is blocked unless this token and `ALLOWED_HOSTS` are configured. This is a basic development guard, not a complete production identity system.
- Production M-Pesa requires an authorized Safaricom Daraja application, callback verification and reconciliation. Bank rails require a regulated bank/PSP agreement. Stablecoin settlement requires wallet custody/key management, chain allowlists, compliance screening, confirmations and recovery controls. Do not put private keys in this app or send them to the model.
- Live FX requires a licensed liquidity provider and quote expiry/slippage handling.
- Before handling customer money, obtain Kenyan legal/compliance advice on applicable payment-service, AML/CFT, data-protection and virtual-asset requirements.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

The unit tests cover invoice creation, duplicate prevention, pending settlement state, explicit confirmation, idempotency, and FX estimate validation.

## Architecture

- `server.ts`: MCP tools and `ui://` resource registration.
- `main.ts`: stateless Streamable HTTP host.
- `src/ledger.ts`: sandbox ledger business rules.
- `mcp-app.html`, `src/mcp-app.ts`, `src/style.css`: MCP Apps UI and host bridge.
- `contracts/MLedgerSettlementRegistry.sol`: owner-managed sandbox registry for settlement hashes and statuses; it has no token-transfer functions and is not connected to the app or deployed by the build.
- `test/ledger.test.ts` and `test/solidity.test.ts`: ledger behavior and contract compilation checks.

The registry stores public on-chain values, including amounts and hashes. Do not put personal data, wallet secrets, account numbers or full settlement destinations on-chain. Hashes of predictable values can still be guessed. This registry is a demonstration component, not an audited payment contract.
