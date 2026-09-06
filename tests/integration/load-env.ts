// Loads the project .env for integration tests (no dotenv dependency).
//
// Precedence: .env WINS over inherited environment variables — deliberate
// deviation from the usual "existing env wins" convention. A stale
// GEMINI_API_KEY in the Windows user environment once shadowed the
// project's real key here (docs/WEAK_POINTS_AND_RISKS.md R-09).
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && m[2]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
