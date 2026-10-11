# 05 — Backend Schema / Data Model
**KIMS Queue — Bhubaneswar Medical Sciences**
*Reverse-engineered from `backend/config/db.js` (authoritative schema + idempotent migrations) and the models.*

Technology: **SQLite** via built-in `node:sqlite` (`DatabaseSync`), WAL mode, `foreign_keys = ON`.

---

## Relationship Overview
```
users ──┬── creates/reviews
        └── head of staff (actor) ───┐
departments 1─n areas 1─n counters      │ (logs)
departments 1─n doctors                   ▼
departments 1─n tokens  (department_id)  audit_logs
areas     1─n tokens  (area_id)
token_seq (department_id PK; drives token_number)
patients 1─n tokens  (patient_id)
doctors  1─n tokens  (doctor_id)  ── waiting/serving/complete workload
tokens   1─n notifications (token_id, ON DELETE CASCADE)
patients 1─n notifications (patient_id)
help_points 1─n sos_requests (assigned_help_id)
users    1─n sos_requests (user_id)
reviews  (user_id→users, department_id→departments, service_area_id→areas)
```

---

## Entities

<details>
<summary>users</summary>

**Purpose:** Staff accounts (admin/officer/reception/doctor).

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT NOT NULL | |
| email | TEXT NOT NULL UNIQUE | lowercased |
| password_hash | TEXT NOT NULL (nullable for OTP-only) | bcrypt |
| role | TEXT NOT NULL default 'officer' | admin \| officer \| reception (auth.register also allows doctor) |
| created_at | TEXT NOT NULL default now | |
| phone | TEXT (migration) | unique index `idx_users_phone` |
| is_demo | INTEGER default 0 (migration) | demo OTP bypass |
| disabled | INTEGER default 0 (migration) | blocked account |
| department_id | INTEGER → departments (migration) | optional scoping (unused by current logic) |

**Relationships:** author of review, actor in audit_logs, owner of sos_requests.
</details>

<details>
<summary>departments</summary>
| Field | Type |
|---|---|
| id | INTEGER PK |
| name | TEXT NOT NULL |
| code | TEXT NOT NULL UNIQUE |
| color | TEXT NOT NULL default '#2563eb' |
| enabled | INTEGER NOT NULL default 1 |

**Relationships:** 1→n areas, 1→n doctors, 1→n tokens; drives `token_seq`.
</details>

<details>
<summary>areas</summary>
| Field | Type |
|---|---|
| id | INTEGER PK |
| department_id | INTEGER NOT NULL → departments ON DELETE CASCADE |
| name | TEXT NOT NULL |
| code | TEXT NOT NULL UNIQUE |
| floor | TEXT |
| enabled | INTEGER NOT NULL default 1 |

**Relationships:** n→1 department; 1→n counters; 1→n tokens.
</details>

<details>
<summary>counters</summary>
| Field | Type |
|---|---|
| id | INTEGER PK |
| area_id | INTEGER NOT NULL → areas ON DELETE CASCADE |
| name | TEXT NOT NULL |
| enabled | INTEGER NOT NULL default 1 |

**Relationships:** n→1 area; tokens.counter_id references it.
</details>

<details>
<summary>token_seq</summary>
Purpose: global per-department token number counter.
| Field | Type |
|---|---|
| department_id | INTEGER PK |
| last_number | INTEGER NOT NULL default 0 |

Drives `tokens.token_number` (monotonic per department).
</details>

<details>
<summary>tokens</summary>

**Purpose:** one row per queue token/encounter.

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| token_number | INTEGER NOT NULL | per-department global |
| queue_seq | INTEGER NOT NULL | per-area 1,2,3… |
| department_id | INTEGER NOT NULL → departments | |
| area_id | INTEGER NOT NULL → areas | |
| counter_id | INTEGER → counters | set on call |
| patient_name | TEXT | |
| patient_id | INTEGER → patients ON DELETE SET NULL (migration) | |
| doctor_id | INTEGER → doctors ON DELETE SET NULL (migration) | null = unassigned |
| preferred_doctor_id | INTEGER → doctors ON DELETE SET NULL (migration) | patient choice |
| status | TEXT NOT NULL default 'queued' | issued\|queued\|called\|serving\|in_consultation\|completed\|skipped\|held\|cancelled\|no_show |
| serving | INTEGER NOT NULL default 0 | |
| priority | TEXT NOT NULL default 'NORMAL' (migration) | NORMAL\|APPOINTMENT\|URGENT\|EMERGENCY |
| priority_reason | TEXT (migration) | |
| called_count | INTEGER NOT NULL default 0 (migration) | recall increments |
| created_at | TEXT NOT NULL default now | |
| called_at | TEXT | |
| completed_at | TEXT | |
| wait_time | INTEGER | seconds |
| estimated_wait_minutes | INTEGER (migration) | staff-set |
| estimated_service_time | TEXT (migration) | HH:MM |
| estimate_updated_at / estimate_updated_by | TEXT (migration) | |

**Constraints:** `TRANSITIONS` enforced in `Token.transition`. **Indexes:** `tokens(area_id,status,created_at)`, `tokens(area_id,queue_seq)`.
**Used by:** virtually all queue logic, dashboard, live board, patient status, doctor workload.
</details>

---

*Continued in Part B (patients, doctors, notifications, reviews, emergency, audit).*

---

<details>
<summary>patients</summary>

**Purpose:** optional registered patient records used by staff and token creation.

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| patient_no | TEXT NOT NULL UNIQUE | generated (`P…`) |
| name | TEXT NOT NULL | |
| phone | TEXT | used for find-or-create |
| age | INTEGER | |
| gender | TEXT | M/F/Other |
| created_at | TEXT NOT NULL default now | |

**Relationships:** 1→n tokens, 1→n notifications. Looked up by phone (idempotent) in `Patient.findOrCreate`.
</details>

<details>
<summary>doctors</summary>

**Purpose:** clinical providers and their operational state.

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | |
| department_id | INTEGER → departments ON DELETE SET NULL | |
| specialization | TEXT | |
| qualification | TEXT (migration) | default 'MBBS' |
| experience_years | INTEGER default 5 (migration) | |
| avg_consultation_minutes | INTEGER default 10 (migration) | drives wait estimates |
| status | TEXT NOT NULL default 'available' | available\|busy\|in_consultation\|break\|offline\|emergency |
| room | TEXT | |
| capacity | INTEGER NOT NULL default 0 | 0 = no limit |
| active | INTEGER NOT NULL default 1 | |
| created_at | TEXT NOT NULL default now | |

**Relationships:** n→1 department; 1→n tokens (as doctor_id). `UNAVAILABLE_FOR_NEW = [offline, break]` blocks auto/new assignment without override.
</details>

<details>
<summary>notifications</summary>

**Purpose:** record of token/queue events and delivery state (pluggable providers).

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| token_id | INTEGER → tokens ON DELETE CASCADE | |
| patient_id | INTEGER → patients ON DELETE SET NULL | |
| event | TEXT NOT NULL | token_created\|doctor_assigned\|approaching\|called\|recalled\|doctor_changed\|queue_delayed\|completed\|no_show\|priority_changed\|estimate_changed |
| channel | TEXT NOT NULL default 'web' | web\|sms\|whatsapp |
| recipient | TEXT | |
| message | TEXT | |
| status | TEXT NOT NULL default 'PENDING' | PENDING\|SENT\|DELIVERED\|FAILED\|RETRYING\|SKIPPED |
| provider / provider_response | TEXT | |
| idempotency_key | TEXT UNIQUE | dedupe |
| created_at / sent_at / failed_at | TEXT | |

**Indexes:** `notifications(token_id)`, `notifications(status)`.
</details>

<details>
<summary>reviews</summary>

**Purpose:** patient/staff feedback with moderation and analytics.

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER → users | |
| reviewer_name | TEXT NOT NULL | |
| reviewer_type | TEXT NOT NULL default 'PATIENT' | PATIENT\|STAFF |
| rating | INTEGER NOT NULL CHECK 1–5 | |
| comment | TEXT NOT NULL | |
| department_id | INTEGER → departments | |
| service_area_id | INTEGER → areas | |
| status | TEXT NOT NULL default 'PENDING' | PENDING\|APPROVED\|REJECTED |
| category | TEXT (migration) | review category constant |
| request | TEXT (migration) | requested improvement |
| is_demo | INTEGER NOT NULL default 0 (migration) | seeded demo reviews |
| created_at / updated_at | TEXT | |

**Index:** `reviews(status)`.
</details>

<details>
<summary>help_points</summary>

**Purpose:** physical assistance points (react to SOS).

| Field | Type |
|---|---|
| id | INTEGER PK |
| name | TEXT NOT NULL |
| type | TEXT |
| floor | TEXT |
| latitude | REAL NOT NULL |
| longitude | REAL NOT NULL |
| enabled | INTEGER NOT NULL default 1 |

**Relationships:** 1→n sos_requests (assigned_help_id).
</details>

<details>
<summary>sos_requests</summary>

**Purpose:** emergency help requests.

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| sos_number | TEXT NOT NULL UNIQUE | generated `SOS-…` |
| user_id | INTEGER → users | |
| latitude / longitude | REAL NOT NULL | |
| accuracy | REAL | |
| status | TEXT NOT NULL default 'ACTIVE' | ACTIVE\|STAFF_NOTIFIED\|ACKNOWLEDGED\|RESPONDING\|RESOLVED\|CANCELLED\|FAILED |
| idempotency_key | TEXT UNIQUE | dedupe |
| assigned_help_id | INTEGER → help_points | nearest at creation |
| nearest_distance | REAL | |
| source | TEXT default 'web' | |
| created_at / acknowledged_at / responding_at / resolved_at / resolved_by | TEXT | |

**Indexes:** `sos(status)`, `sos(created)`, `sos(user)`.
</details>

<details>
<summary>audit_logs</summary>

**Purpose:** append-only trace of queue-changing actions (WHO/WHAT/WHEN/WHY).

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| actor_id | INTEGER | user id |
| actor_name | TEXT | |
| action | TEXT NOT NULL | TOKEN_CREATED\|DOCTOR_ASSIGNED\|DOCTOR_CHANGED\|PATIENT_CALLED\|PATIENT_RECALLED\|PATIENT_IN_CONSULTATION\|PATIENT_COMPLETED\|PATIENT_SKIPPED\|PATIENT_NO_SHOW\|PATIENT_HELD\|PATIENT_CANCELLED\|PRIORITY_CHANGED\|ESTIMATE_UPDATED\|QUEUE_REASSIGNED\|DOCTOR_STATUS_CHANGED\|DOCTOR_CREATED\|DOCTOR_UPDATED\|NOTIFICATION_SENT |
| target_type / target_id | TEXT / INTEGER | |
| old_value / new_value | TEXT | JSON for estimates |
| reason | TEXT | |
| created_at | TEXT NOT NULL default now | |

**Index:** `audit_logs(created_at)`.
</details>

---

*Next: see `06_API_DOCUMENTATION.md`.*