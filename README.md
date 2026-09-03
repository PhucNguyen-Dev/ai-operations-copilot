# AI Operations Copilot

Internal operations platform for a simulated education/training company — a portfolio
prototype demonstrating AI + workflow automation across Admissions, Marketing,
Academic, and Operations.

- **Spec:** `PRODUCT_SPEC.md` · **Features:** `FEATURES.md` · **Architecture:** Phase 1 architecture doc
- **Current status:** Phase 2 — Database/CRM (schema, RLS, seed data, minimal verification app)

## Quick start

```bash
npm install
cp .env.example .env        # fill in Supabase keys (docs/DATABASE.md step 3)
npm run seed:users          # create the 5 demo logins (password: demo1234)
npm run dev                 # http://localhost:3000
```

Full setup runbook (including the Supabase-side SQL steps): **[docs/DATABASE.md](docs/DATABASE.md)**

## Demo logins

| Email | Role | Sees |
|---|---|---|
| admin@demo.dev | admin | everything |
| operations@demo.dev | operations | leads + automation runs |
| counselor@demo.dev | admissions | only assigned leads |
| marketing@demo.dev | marketing | own modules only (Phase 6) |
| teacher@demo.dev | teacher | own modules only (Phase 6) |

Password for all: `demo1234` (synthetic demo data only).
