// Public release provenance only. No credentials, environment values or business data.
export const dynamic = 'force-dynamic';
export function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return Response.json({ commit: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
