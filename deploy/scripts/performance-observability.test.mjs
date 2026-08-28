import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const logFormat = await readFile(
  new URL('../nginx/huayue-performance-observability.conf', import.meta.url),
  'utf8',
);
const proxy = await readFile(
  new URL('../nginx/huayue-performance-proxy.inc', import.meta.url),
  'utf8',
);
const rotation = await readFile(
  new URL('../logrotate/huayue-performance', import.meta.url),
  'utf8',
);

for (const field of [
  '$request_id',
  '$request_time',
  '$upstream_connect_time',
  '$upstream_header_time',
  '$upstream_response_time',
  '$bytes_sent',
  '$request_length',
  '$connection_requests',
  '$server_protocol',
  '$upstream_addr',
  '$upstream_status',
  '$request_completion',
]) {
  assert.match(logFormat, new RegExp(field.replace('$', '\\$')));
}
assert.match(proxy, /proxy_set_header X-Request-ID \$request_id/);
assert.match(proxy, /access_log \/var\/log\/nginx\/huayue-performance\.access\.log huayue_performance/);
const activeLogFormat = logFormat
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
assert.doesNotMatch(activeLogFormat, /authorization|cookie|request_body/i);
assert.match(rotation, /daily[\s\S]*rotate 7[\s\S]*compress/);

console.log('performance observability checks passed');
