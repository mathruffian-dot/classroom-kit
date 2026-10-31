import { unstable_readConfig } from 'wrangler';
const config = unstable_readConfig({ config: 'wrangler.jsonc' }, { hideWarnings: true });
const binding = config.d1_databases?.find((db) => db.binding === 'DB');
if (!binding?.database_id || binding.database_id === '00000000-0000-0000-0000-000000000000') {
  console.error(
    '尚未設定自己的 D1。請先執行 npx wrangler d1 create classroom-kit-db，再將回傳的 database_id 填入 wrangler.jsonc。',
  );
  process.exit(1);
}
if (config.vars?.APP_MODE !== 'd1' || config.vars?.ALLOW_PUBLIC_DEMO !== 'false') {
  console.error('正式部署必須使用 APP_MODE=d1，並關閉 ALLOW_PUBLIC_DEMO。');
  process.exit(1);
}
console.log('部署設定檢查通過；請確認已設定 TEACHER_PASSWORD 與 SESSION_SECRET Secrets。');
