# AI Operations Copilot

Internal operations platform for a simulated education/training company — a portfolio
prototype demonstrating AI + workflow automation across Admissions, Marketing,
Academic, and Operations.

- **Docs:** [Roadmap](docs/ROADMAP.md) · [Spec](docs/PRODUCT_SPEC.md) · [Features](docs/FEATURES.md) · Architecture: `docs/AI Operations Copilot — Phase 1 System A.md`
- **Current status:** Phase 4 complete ✅ — P0 admissions pipeline done end-to-end. Phase 5 (real dashboards + Automation Logs Viewer) is next.

## Quick start

```bash
npm install
cp .env.example .env        # fill in Supabase + Gemini keys (see docs/ROADMAP.md)
npm run seed:users          # one-time: create the 5 demo logins (password: demo1234)
npm run dev                 # app: http://localhost:3000
npm run n8n                 # n8n: http://localhost:5678 (loads .env secrets — always start n8n this way)
```

## Demo logins

| Email | Role | Sees |
|---|---|---|
| admin@demo.dev | admin | everything |
| operations@demo.dev | operations | leads + automation runs |
| counselor@demo.dev | admissions | only assigned leads |
| marketing@demo.dev | marketing | own modules only (Phase 6) |
| teacher@demo.dev | teacher | own modules only (Phase 6) |

Password for all: `demo1234` (synthetic demo data only).
