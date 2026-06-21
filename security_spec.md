# Firebase Security Specification (Zero-Trust Model)

This document outlines the attribute-based access control (ABAC) and integrity rules safeguarding our Cloud Firestore data layers (`settings` and `daily_settles`).

---

## 1. Data Invariants
1. **Immutable IDs**: Document ID matching is strictly required (`isValidId`).
2. **Settings Invariant**: A branch setting document ID must match the contained `branch_name` and prevent identity spoofing.
3. **Daily Settle Security**: Settle packages must contain a valid `recordId` matching the document ID and restrict unrestricted payload injections (size limits, verified keys).

---

## 2. The Great "Dirty Dozen" Attack Vectors (TDD Payloads)

Here are the 12 malicious payloads meant to breach boundary controls, all of which are rejected under our fortress security model:

### Attack 01: Shadow Key Injection (Settings Profiles)
*   **Target**: `/settings/{branchName}`
*   **Payload**: `{"branch_name": "홍대점", "pin_hash": "...", "role": "branch", "is_active": true, "brand": "마라탕", "isSystemRootAdmin": true}`
*   **Vulnerability**: Attacker injects unregistered high-privileged shadow properties to bypass permission groups.
*   **Rule Defense**: Strict keys size and existence constraints via `data.keys().size() && affectedKeys().hasOnly()`.

### Attack 02: Shadow Settle Injection
*   **Target**: `/daily_settles/{recordId}`
*   **Payload**: `{"recordId": "2026-06-21-강남점", "master": {}, "expenses": [], "staff": [], "unsafeDatabaseOverload": "X".repeat(1024 * 1024)}`
*   **Vulnerability**: Overflowing Firestore bounds causing quota or memory leaks on processing.
*   **Rule Defense**: Checked via exact strict key checks on create/update operations.

### Attack 03: Identity Spoofing (Owner Forgery)
*   **Target**: `/settings/강남점`
*   **Payload**: `{"branch_name": "역삼점", "pin_hash": "...", "role": "branch", "is_active": true, "brand": "마라탕"}`
*   **Vulnerability**: Document ID is "강남점", but the body specifies "역삼점" which causes mismatch and logic hijacking.
*   **Rule Defense**: Hard checks verifying `incoming().branch_name == docId`.

### Attack 04: Untyped Field Payload (Corruption)
*   **Target**: `/settings/신촌점`
*   **Payload**: `{"branch_name": 12345, "pin_hash": true, "role": 12.5, "is_active": "active", "brand": []}`
*   **Vulnerability**: Bypassing client typing to crash server-side or front-end parsers with mixed primitive data.
*   **Rule Defense**: Strict validation helpers `isValidSetting()` utilizing type assertions (`is string`, `is bool`).

### Attack 05: Identity Privilege Escalation
*   **Target**: `/settings/홍대점`
*   **Payload**: `{"branch_name": "홍대점", "pin_hash": "...", "role": "admin", "is_active": true, "brand": "마라탕"}`
*   **Vulnerability**: Standard branch attempting to escalate their own role to "admin".
*   **Rule Defense**: Prevented via matching client identity against administrative roles.

### Attack 06: Unlimited Record Poisoning
*   **Target**: `/daily_settles/2026-06-21-신촌점`
*   **Payload**: `{"recordId": "A".repeat(5000), "master": {}, "expenses": [], "staff": []}`
*   **Vulnerability**: Writing extremely large ID parameters to cause Denial of Service tracking.
*   **Rule Defense**: Verified `isValidId` restricts size of keys strictly.

### Attack 07: Settle Overwrite (Audit Tampering)
*   **Target**: `/daily_settles/2026-06-21-홍대점`
*   **Payload**: `{"recordId": "2026-06-21-홍대점", "master": {"sales": 0}}` (deleting expenses/staff logs completely)
*   **Vulnerability**: Malicious client modifies historical audit trail, omitting core expenses details.
*   **Rule Defense**: Settle schema is strict and does not permit partial entity structural omission.

### Attack 08: Blank Keys Structure Injection
*   **Target**: `/settings/건대점`
*   **Payload**: `{}`
*   **Vulnerability**: Attacking database schema integrity by creating totally blank documents.
*   **Rule Defense**: Exact required fields assertion enforces proper key counts.

### Attack 09: Timestamp Spoofing (Historical Hijack)
*   **Target**: `/daily_settles/2026-06-21-건대점`
*   **Payload**: `{"recordId": "2026-06-21-건대점", "_updatedAt": "1994-01-01T00:00:00Z"}`
*   **Vulnerability**: Overwriting historical modification dates to trick analytical audits.
*   **Rule Defense**: Forced matching to server timestamp.

### Attack 10: Role Hijacking on Update
*   **Target**: `/settings/신림점`
*   **Payload**: Modifying `role` parameter on existing profiles.
*   **Vulnerability**: Standard user attempting to overwrite role flags on metadata tables.
*   **Rule Defense**: Role fields are strictly gated and immutable for non-admin context.

### Attack 11: Bulk Deletion (Wiping Logs)
*   **Target**: Delete on `/daily_settles`
*   **Vulnerability**: Wiping historic registers in bulk.
*   **Rule Defense**: Deletions strictly guarded.

### Attack 12: Invalid System Invariant Bypass
*   **Target**: Overriding config properties with corrupted, arbitrary JSON trees.
*   **Rule Defense**: High-trust validation safeguards schema.
