import {register} from 'node:module'

register('tsx/esm', import.meta.url, {data: true})
await import('./reader-worker.ts')
