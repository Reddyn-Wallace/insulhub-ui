import { NextRequest, NextResponse } from 'next/server';
import { requireInsulhubAuth } from '@/lib/insulhub-auth';

async function retired(request: NextRequest) {
  const denied = await requireInsulhubAuth(request);
  if (denied) return denied;
  return NextResponse.json({ error: 'Templates are now managed in Settings → Templates. Reload to use the ordinary SMS and Email template list.' }, { status: 410, headers: { 'cache-control': 'private, no-store' } });
}
export const GET = retired;
export const PATCH = retired;
