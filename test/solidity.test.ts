import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRegistry } from '../scripts/compile-contracts.ts';

test('Solidity registry compiles to bytecode without token-transfer entrypoints', async () => {
  const contract = await compileRegistry();
  const functions = contract.abi
    .filter((entry: { type: string }) => entry.type === 'function')
    .map((entry: { name: string }) => entry.name);

  assert.ok(contract.evm.bytecode.object.length > 0);
  assert.ok(functions.includes('recordSettlement'));
  assert.ok(functions.includes('confirmSettlement'));
  assert.ok(functions.includes('cancelSettlement'));
  assert.ok(functions.includes('setOperator'));
  const tokenMovementEntrypoints = ['transfer', 'transferFrom', 'safeTransfer', 'safeTransferFrom', 'deposit', 'withdraw'];
  assert.ok(!functions.some((name: string) => tokenMovementEntrypoints.includes(name)));
});
