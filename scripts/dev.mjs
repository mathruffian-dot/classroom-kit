import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WRANGLER_LOG_PATH ||= path.join(root, '.wrangler', 'logs', 'wrangler.log');
process.env.WRANGLER_SEND_METRICS ||= 'false';
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const run = (args) =>
  spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
for (const args of [
  [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local'],
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'],
]) {
  const result = run(args);
  if (result.status !== 0) process.exit(result.status || 1);
}
const secured = process.argv.includes('--secured');
const worker = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    ...(!secured ? ['--var', 'APP_MODE:demo'] : []),
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
worker.on('exit', (code) => {
  process.exitCode = code || 0;
});
process.on('SIGINT', () => worker.kill('SIGTERM'));
process.on('SIGTERM', () => worker.kill('SIGTERM'));
