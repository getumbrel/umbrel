import {parentPort, workerData} from 'node:worker_threads'

import {serializeError, type SerializedError} from '../file-index-worker-protocol.js'
import FileIndexReader, {isPhotosRead, type FileIndexReadMethod, type FileIndexReaderPaths} from './reader.js'

export type FileIndexReaderRequest = {id: number; method: FileIndexReadMethod; args: unknown[]}
export type FileIndexReaderResponse =
	| {type: 'ready'}
	| {type: 'startup-error'; error: SerializedError}
	| {type: 'snapshot'; id: number}
	| {type: 'result'; id: number; result: unknown}
	| {type: 'error'; id: number; error: SerializedError}

if (!parentPort) throw new Error('File index reader requires a parent port')
const port = parentPort
const post = (message: FileIndexReaderResponse) => port.postMessage(message)

try {
	const reader = new FileIndexReader(workerData as FileIndexReaderPaths)
	port.on('message', ({id, method, args}: FileIndexReaderRequest) => {
		try {
			reader.beginSnapshot(isPhotosRead(method))
			post({type: 'snapshot', id})
			const result = reader.read(method, args as Parameters<typeof reader.read>[1])
			reader.endSnapshot()
			post({type: 'result', id, result})
		} catch (error) {
			reader.endSnapshot()
			post({type: 'error', id, error: serializeError(error)})
		}
	})
	post({type: 'ready'})
} catch (error) {
	post({type: 'startup-error', error: serializeError(error)})
	port.close()
}
