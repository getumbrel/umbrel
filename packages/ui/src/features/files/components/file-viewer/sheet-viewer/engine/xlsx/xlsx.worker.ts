// Module worker entry: new Worker(new URL('./xlsx.worker.ts', import.meta.url), {type: 'module'})

import {createXlsxHandler, type XlsxCall} from './protocol'

const handle = createXlsxHandler()

self.onmessage = async (event: MessageEvent<XlsxCall>) => {
	const {reply, transfer} = await handle(event.data)
	self.postMessage(reply, {transfer})
}
