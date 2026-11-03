// Module worker entry: new Worker(new URL('./csv.worker.ts', import.meta.url), {type: 'module'})

import {createCsvHandler, type CsvCall} from './protocol'

const handle = createCsvHandler()

self.onmessage = (event: MessageEvent<CsvCall>) => {
	const {reply, transfer} = handle(event.data)
	self.postMessage(reply, {transfer})
}
