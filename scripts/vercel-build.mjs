import { spawnSync } from 'node:child_process';
// Sensitive production credentials stay within Vercel. All schema steps are repeatable.
function run(script) {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.env.VERCEL_ENV === 'production' &&
    (process.env.DEAD_QUOTE_DATE_CAPTURE_ENABLED === 'true' || process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED === 'true')) {
  run('dead-followups:migrate');
  run('dead-followups:readiness');
}
run('build');
