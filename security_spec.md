# M-Ledger Firestore Security Specification (Phase 0–5)

## 1. Data Invariants
1. **Strict Tenant Isolation**: Every document (`UserProfile`, `Invoice`, `Settlement`, `Beneficiary`, `AuditLog`) is owned by a single verified Firebase Auth user (`request.auth.uid == userId`) with `email_verified == true`. Cross-user reads, lists, or writes are unconditionally denied.
2. **PII Isolation**: `/users/{userId}` contains user email (`email`) and organization metadata. Only `isVerifiedOwner(userId)` can `get`, `create`, or `update` their own profile; `list` on `/users` is denied.
3. **Referential Integrity (Master Gate)**:
   - Invoices, settlements, beneficiaries, and audit logs under `/users/{userId}/...` require an existing parent `/users/{userId}` document.
   - A `Settlement` cannot be created unless its referenced `invoiceId` exists in `/users/{userId}/invoices/{invoiceId}` and belongs to `request.auth.uid`.
4. **Immutable Ownership & Temporal Integrity**: `uid` / `ownerId` and `createdAt` cannot be modified after creation. `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on updates.
5. **Terminal State Locking**:
   - Once an `Invoice` reaches `status == 'settled'`, no further mutations are permitted.
   - Once a `Settlement` reaches `status == 'completed'` or `status == 'failed'`, no further mutations are permitted.
6. **Append-Only Audit Logs**: `/users/{userId}/auditLogs/{logId}` documents can be read and created by the verified owner, never updated or deleted.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Create invoice with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Authenticated user with `email_verified == false` attempting to create invoice -> `PERMISSION_DENIED`.
3. **Identity Spoofing (Cross-Tenant Create)**: User A writes to `/users/userB/invoices/inv1` with `ownerId: 'userB'` -> `PERMISSION_DENIED`.
4. **OwnerId Mismatch**: User A writes to `/users/userA/invoices/inv1` with `ownerId: 'userB'` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: User A creates invoice including extra field `isAdmin: true` or `bypassGate: true` -> `PERMISSION_DENIED` (blocked by `keys().hasOnly(...)`).
6. **ID Poisoning (1.5KB Document ID)**: User A creates invoice at `/users/userA/invoices/<1500-char-id>` or with invalid characters `../admin` -> `PERMISSION_DENIED` (blocked by `isValidId()`).
7. **Orphaned Settlement Creation**: User A creates settlement referencing non-existent `invoiceId: 'missing-inv'` -> `PERMISSION_DENIED` (blocked by `exists(...)`).
8. **Backdated Timestamp Spoofing**: User A creates invoice with client-supplied `createdAt` instead of server `request.time` -> `PERMISSION_DENIED`.
9. **Terminal State Mutation**: User A attempts to update a `completed` settlement back to `pending_confirmation` -> `PERMISSION_DENIED`.
10. **Immutable Field Tampering**: User A updates invoice attempting to alter `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **Value Poisoning on Update**: User A updates invoice `status` to an invalid type `12345` or disallowed value `'hacked'` -> `PERMISSION_DENIED` (blocked by `isValidInvoice(incoming())`).
12. **Blanket Collection Scraping (`list` without owner filter)**: Any list query on `/users/{userId}/invoices` by User B (or without `resource.data.ownerId == request.auth.uid`) -> `PERMISSION_DENIED`.

## 3. Red Team Conflict Audit Summary
- **Identity Spoofing**: Closed via `isVerifiedOwner(userId)` + `data.ownerId == request.auth.uid` + immutable `ownerId` on update.
- **State Shortcutting**: Closed via action-specific `affectedKeys().hasOnly(...)` + terminal state checks (`existing().status != 'settled'` / `!(existing().status in ['completed', 'failed'])`) + status transition validation.
- **Resource Poisoning**: Closed via `isValidId()` regex + `.size()` upper bounds on every string and numeric upper bounds (`<= 1000000000`).
- **Shadow Updates**: Closed via strict `keys().hasAll(...) && keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update.
