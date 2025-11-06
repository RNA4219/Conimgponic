import { register } from 'node:module';

if (process.env.TS_NODE_TRANSPILE_ONLY === undefined) {
  process.env.TS_NODE_TRANSPILE_ONLY = '1';
}

register('ts-node/esm', import.meta.url);
