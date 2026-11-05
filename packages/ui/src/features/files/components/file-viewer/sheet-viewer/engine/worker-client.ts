// The UI side of a sheet engine's worker (csv.worker.ts, xlsx.worker.ts),
// which answers each {id, request} with {id, result} or {id, error}. A worker
// that fails to load or throws outside a call, or is disposed, rejects every
// call still waiting.
export function createWorkerClient<Request, ErrorData>(worker: Worker, toError: (data: ErrorData) => Error) {
	let nextId = 0
	let disposed = false
	const waiting = new Map<number, {resolve: (result: never) => void; reject: (error: Error) => void}>()
	const failAll = (error: Error) => {
		for (const call of waiting.values()) call.reject(error)
		waiting.clear()
	}
	const onMessage = ({data}: MessageEvent<{id: number; result: unknown} | {id: number; error: ErrorData}>) => {
		const call = waiting.get(data.id)
		if (!call) return
		waiting.delete(data.id)
		if ('result' in data) call.resolve(data.result as never)
		else call.reject(toError(data.error))
	}
	const onError = (event: ErrorEvent) => failAll(new Error(event.message || 'The worker failed'))
	worker.addEventListener('message', onMessage)
	worker.addEventListener('error', onError)
	return {
		call: <Result>(request: Request, transfer: Transferable[] = []) =>
			new Promise<Result>((resolve, reject) => {
				if (disposed) return reject(new DOMException('The worker was disposed', 'AbortError'))
				const id = nextId++
				waiting.set(id, {resolve, reject})
				worker.postMessage({id, request}, transfer)
			}),
		dispose: () => {
			disposed = true
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			worker.terminate()
			failAll(new DOMException('The worker was disposed', 'AbortError'))
		},
	}
}
