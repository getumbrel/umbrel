import type {CallToolResult} from '@modelcontextprotocol/server'

import type Machines from '../../machines/machines.js'
import type {MachineAgent} from '../../machines/machines.js'
import type {InternalTrpcCaller} from '../../server/trpc/index.js'
import type Mcp from '../mcp.js'

export type McpToolContext = {
	rpc: InternalTrpcCaller
	mcp: Mcp
	dataDirectory: string
	// Console control goes to the module directly so the agent behind the
	// request can be named at the console; every other tool goes through routes
	machines: Pick<Machines, 'control' | 'screenshot'>
	agent?: MachineAgent
}

// Matches the visible settings row label so agents can point the user at it verbatim
export const MCP_PERMISSION_REMEDIATION = 'The device owner can grant access in Settings → AI agents (MCP).'

export function toolResult(value: unknown): CallToolResult {
	return {
		content: [{type: 'text', text: JSON.stringify(value, null, 2)}],
	}
}

export function runTool(
	context: McpToolContext,
	name: string,
	input: unknown,
	operation: () => Promise<unknown>,
): Promise<CallToolResult> {
	return runToolResult(context, name, input, async () => toolResult(await operation()))
}

// For tools whose result is more than JSON text, such as a screenshot
export async function runToolResult(
	context: McpToolContext,
	name: string,
	input: unknown,
	operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
	const fields = input && typeof input === 'object' ? Object.keys(input).join(', ') : ''
	context.mcp.logger.log(`Calling tool '${name}'${fields ? ` with fields: ${fields}` : ''}`)
	try {
		return await operation()
	} catch (error) {
		context.mcp.logger.error(`Tool '${name}' failed`, error)
		const message = error instanceof Error ? error.message : String(error)
		return {
			content: [{type: 'text', text: message.replaceAll(context.dataDirectory, '<data-directory>')}],
			isError: true,
		}
	}
}

// Log lines from third-party containers and journal units are unbounded, and the
// whole result is JSON-stringified into memory, so clip each line and keep only
// the newest bytes that fit the budget
const MAX_LOG_LINE_LENGTH = 2_000
export const MAX_LOG_BYTES = 64_000

export function newestLogs(logs: string, lines: number) {
	const allLines = logs.split('\n')
	// Drop the empty entry produced by a trailing newline so it doesn't take a slot
	if (allLines.at(-1) === '') allLines.pop()
	let clipped = false
	const requested = allLines.slice(-lines).map((line) => {
		if (line.length <= MAX_LOG_LINE_LENGTH) return line
		clipped = true
		return `${line.slice(0, MAX_LOG_LINE_LENGTH)}…`
	})
	const kept: string[] = []
	let bytes = 0
	for (const line of requested.toReversed()) {
		bytes += Buffer.byteLength(line) + 1
		if (bytes > MAX_LOG_BYTES) break
		kept.push(line)
	}
	kept.reverse()
	const droppedLines = requested.length - kept.length
	return {
		logs: kept.join('\n'),
		...(clipped || droppedLines > 0 ? {truncated: true, droppedLines} : {}),
	}
}
