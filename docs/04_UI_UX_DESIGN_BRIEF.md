# 04 — UI/UX Design Brief
**KIMS Queue — Bhubaneswar Medical Sciences**
*Reverse-engineered from the current UI. Describes the product as built (not a proposed redesign).*

---

## 1. Design Language

### 1.1 Design tokens (source: `tailwind.config.js`, `src/index.css`)
| Token | Value | Usage |
|---|---|---|
| `medical-primary` | `#075A9F` | Primary accent / brand blue |
| `medical-primary-dark` | `#064D88` | Primary hover |
| `medical-secondary` | `#1599C5` | Secondary/cyan accent (eyebrows) |
| `medical-secondary-light` | `#E6F3F9` | Soft blue fills |
| `medical-green` | `#00C878` | Success / live |
| `medical-emergency` | `#FF1717` | Emergency only |
| `emergency-dark` | `#E50914` | Emergency hover |
| `surface` | `#F5F9FC` | Page background |
| `ink` | `#102A43` | Deep navy (headings/text) |
| `ink-muted` | `#6B8198` | Muted text |
| `line` | `#E1EAF2` | Borders/dividers |

### 1.2 Typography
- Font: **Inter** (with system fallbacks), `font-family` set in `tailwind.config.js`.
- Scale: `text-[11px]` (micro meta) → `text-xs` → `text-sm` (default body) → `text-lg`/`text-xl` (subheadings) → `text-2xl`/`text-3xl`/`text-4xl`+ (headings).
- Eyebrow pattern: `text-sm font-semibold uppercase tracking-[0.18em]` in cyan or emergency red.
- Headings: `font-extrabold`/`font-black`, color `#102A43`.

### 1.3 Spacing
- Utilities from Tailwind: `px-4` container gutters, `max-w-7xl` page width, section padding `py-16 lg:py-24`, card padding `p-4…p-10`, gaps `gap-2…gap-6`.

### 1.4 Border radius
- `rounded-xl` (buttons/inputs), `rounded-2xl` (cards/panels), `rounded-3xl`/`rounded-[24px]`/`rounded-[28px]` (hero/CTA cards), `rounded-full` (pills/badges).

### 1.5 Shadows
- `shadow-sm`/`shadow-card` (default cards), `shadow-cardhover` (raise on hover), hero CTAs use `0 20px 50px -30px rgba(7,90,159,0.35)`.

### 1.6 Buttons (`index.css` component classes)
- `.btn` base; `.btn-primary` (blue), `.btn-secondary` (outline navy), `.btn-ghost` (soft blue), `.btn-success` (green), `.btn-danger` / `.btn-emergency` (red, white text). Variants tuned inline with `!px`, `!py`, `!text-base`. Pill = add `!rounded-full`.

### 1.7 Cards
- `.card` (white, 16px radius, thin border `--line`, subtle shadow) with optional `hover:-translate-y-1 hover:shadow-cardhover`; gradient brand cards use `.gradient-brand` (blue→cyan).

### 1.8 Forms
- `.input` (rounded-xl, 1px `--line` border, focus ring blue), `.label`, `.field-hint`, `.input-error`. Selects reuse `.input`.

### 1.9 Badges / chips / pills
- `.badge` (colored chips), `chip`, `utility-pill`, `status-dot`, `skeleton`, `empty-icon`.

### 1.10 Modals / drawers
- Modal: `fixed inset-0 z-50 … bg-slate-900/60 backdrop-blur-sm`, centered `.card` panel with `pop-in`/`modalIn` animation. Drawer (reviews): slide-over panel.

### 1.11 Navigation
- Sticky white top navbar with brand, desktop links, notification bell, reviews, staff login / logout, and a mobile hamburger menu. Footer is dark navy (`#102A43`) with brand, nav links, support, and emergency CTA.

---

## 2. Layout & Responsiveness
- **Desktop (1440+):** `max-w-7xl` centered; multi-column grids (`lg:grid-cols-2/3/4`, `xl:grid-cols-3`).
- **Laptop (1024):** `lg:` breakpoint switches hero to two columns; staff console tabs wrap.
- **Tablet/mobile:** grids collapse to 1–2 columns; hero stacks; buttons wrap; navbar collapses to hamburger; modals scroll (`max-h`, `overflow-y-auto`).
- No horizontal overflow on 375–430 px (font/utilities are fluid; cards/buttons wrap).

---

*Next: Part B (Navigation, Screens, Interaction).*

---

## 3. Navigation (public SPA)
- **Navbar links:** `Token Kiosk (/`)`, `My Token (/status)`, `Live Board (/live)`, `Departments (/departments)`, `Help (/help)`; plus **Reviews** (opens drawer), notification bell, **Staff Login** (`/login`) or Logout.
- **Footer links:** same public set + Support (Emergency Help, Contact, Privacy, Terms) + an Emergency CTA button.

## 4. Screen Inventory

### 4.1 Home `/`  (User: public)
- Purpose: landing + token kiosk + live queue + departments + emergency + reviews + FAQ.
- Components: `Hero`, `EmergencyHelp`, `StatsSection`, `TokenKiosk`, `LiveQueueCard`, `DepartmentShowcase`, `HowItWorks`, `ExperienceSections`, `HomeFAQ`, `FinalCTA`, ReviewDrawer trigger.
- States: initial load, kiosk empty, kiosk submitting, token issued; live queue loading/data/empty.
- Notes: hero carries an **Emergency** pill (upper-right) opening the EmergencyModal.

### 4.2 Token Status `/status`  (public)
- Purpose: live token tracking.
- Components: status chip, token code card, doctor/room, dynamic metrics (people-ahead/position, estimated wait/service), action buttons, live-sync indicator.
- States: idle/loading/ready/notfound/error; terminal vs active.

### 4.3 Live Board `/live`  (public)
- Purpose: TV-style queue display.
- Components: department filter, per-area cards (serving pill, next-up pills, on-hold), skeleton loading.
- States: loading/data/empty.

### 4.4 Departments `/departments`  (public)
- Cards per department with service-area chips (floor info); skeleton/error/empty states.

### 4.5 Help `/help`  (public)
- FAQ accordion + "Still need help" panel with helpdesk contact.

### 4.6 Login `/login`  (staff)
- Two-step phone → OTP; dev hints; email alternative available via API.

### 4.7 Staff Console `/staff`, `/console`  (officer/admin/reception/doctor)
- Tabs: Overview, Doctors, Live Queue, Tokens, Patients, History.
- Key screens/panels: KPI cards, Unassigned-Tokens attention panel (Assign Doctor), Live Activity Feed, Doctor Directory + per-doctor queue + status controls, registered-patient modals (assign/reassign/add doctor), patient search/register, token filter table, audit log.
- Modals: **Assign Patient to Doctor**, **Reassign Patient to Doctor**, Add Doctor, plus confirmations.

### 4.8 Admin `/admin`  (admin)
- Tabs: Overview (charts), Manage (departments/users/areas/counters), Reviews (analytics + moderation), SOS.

### 4.9 Emergency & Feedback overlays
- `EmergencyModal` (call/maps/desk/nearest-help/SOS), `ReviewDrawer`, toasts.

## 5. Interaction Patterns
- **Modals:** centered, backdrop blur, dismiss via Cancel/✕; confirm disabled until valid.
- **Dropdowns/selects:** native `<select class="input">` with cascading dependencies (dept → area → doctors).
- **Confirmation dialogs:** in-modal confirm (e.g., reassign cancel) styled `.btn-secondary`/`.btn-danger`.
- **Toasts:** `ToastProvider` bottom-right, auto-dismiss 3.5s, colored by success/error/info.
- **Loading:** skeleton shimmer, pulse indicators, button `disabled`/label swap ("Generating Token…").
- **Empty states:** dashed placeholder + `empty-icon` emoji + guidance text.
- **Error states:** inline rose panels with message + retry/fallback actions.

---

*Next: see `05_BACKEND_SCHEMA.md`.*