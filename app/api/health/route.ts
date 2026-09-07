import { NextResponse } from 'next/server'
import { rateLimiterStats } from '@/lib/rate-limit'
import { getLastGeneration } from '@/lib/gemini'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rateLimiter: rateLimiterStats(),
    lastAiGeneration: getLastGeneration(),
  })
}
