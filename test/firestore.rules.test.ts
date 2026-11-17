import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('firestore.rules enforces all Eight Pillars and covers every blueprint collection', async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const blueprint = JSON.parse(await readFile(new URL('../firebase-blueprint.json', import.meta.url), 'utf8'));

  assert.match(rules, /rules_version = '2';/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /function isValidUserProfile\(data, userId\)/);
  assert.match(rules, /function isValidInvoice\(data, userId\)/);
  assert.match(rules, /function isValidSettlement\(data, userId\)/);
  assert.match(rules, /function isValidBeneficiary\(data, userId\)/);
  assert.match(rules, /function isValidAuditLog\(data, userId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(/);
  assert.match(rules, /existing\(\)\.status != 'settled'/);
  assert.match(rules, /!\(existing\(\)\.status in \['completed', 'failed'\]\)/);
  assert.match(rules, /resource\.data\.ownerId == request\.auth\.uid/);

  // Every collection defined in firebase-blueprint.json must be secured in firestore.rules
  for (const path of Object.keys(blueprint.firestore)) {
    const segment = path.split('/').filter(Boolean).slice(-2, -1)[0];
    assert.ok(rules.includes(segment!), `Missing rule match block for collection segment ${segment}`);
  }
});
