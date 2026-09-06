# AI Operations Copilot

Internal operations platform for a simulated education/training company — a portfolio
prototype demonstrating AI + workflow automation across Admissions, Marketing,
Academic, and Operations.

- **Docs:** [Roadmap](docs/ROADMAP.md) · [Spec](docs/PRODUCT_SPEC.md) · [Features](docs/FEATURES.md) · [Weak points & risks](docs/WEAK_POINTS_AND_RISKS.md) · Architecture: `docs/AI Operations Copilot — Phase 1 System A.md`
- **Current status:** Phase 7 complete — all 30 features (P0+P1+P2) built. Roadmap finished.

## Quick start

```bash
npm install
cp .env.example .env        # fill in Supabase + Gemini keys (see docs/ROADMAP.md)
npm run seed:users          # one-time: create the 5 demo logins (password: demo1234)
npm run dev                 # app: http://localhost:3000
npm run n8n                 # n8n: http://localhost:5678 (loads .env secrets — always start n8n this way)

npm test                    # unit tests (deterministic, no network)
npm run typecheck           # TypeScript strict check
```

## App routes

| Route | Access | What it is |
|---|---|---|
| `/login` | public | Supabase Auth login |
| `/` | all roles | Lead Dashboard (RLS-scoped, filterable) |
| `/leads/new` | admissions/admin | Test Lead intake — triggers the n8n pipeline |
| `/leads/[id]` | RLS-scoped | Lead detail: AI analysis, tasks, emails |
| `/runs` · `/runs/[id]` | operations/admin | Automation Logs Viewer (F-019) |
| `/admin` | operations/admin | Operations overview (F-025) |

## Demo logins

| Email | Role | Sees |
|---|---|---|
| admin@demo.dev | admin | everything |
| operations@demo.dev | operations | leads + automation logs + overview |
| counselor@demo.dev | admissions | only assigned leads |
| marketing@demo.dev | marketing | Phase 6 marketing tools |
| teacher@demo.dev | teacher | Phase 6 academic tools |

Password for all: `demo1234` (synthetic demo data only).
