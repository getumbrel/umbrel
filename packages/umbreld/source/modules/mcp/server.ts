import nodePath from 'node:path'

import type {ErrorRequestHandler, RequestHandler, Response, Router} from 'express'
import express from 'express'
import {createMcpHandler, McpServer} from '@modelcontextprotocol/server'
import {toNodeHandler} from '@modelcontextprotocol/node'

import type Umbreld from '../../index.js'
import {OWNER_ACCOUNT_ID, type Principal} from '../auth/auth.js'
import {downloadFiles, uploadFile} from '../files/api.js'
import type UploadDiskPreflight from '../server/upload-disk-preflight.js'
import {createInternalTrpcCaller} from '../server/trpc/index.js'
import type {McpPermissions} from './mcp.js'
import registerAppTools from './tools/apps.js'
import registerFileTools from './tools/files.js'
import registerMachineTools from './tools/machines.js'
import {MCP_PERMISSION_REMEDIATION, type McpToolContext} from './tools/shared.js'
import registerSystemInfoTools from './tools/system-info.js'
import registerSystemManagementTools from './tools/system-management.js'

// Cap on JSON-RPC request bodies, applied whatever their content type
const BODY_LIMIT = '4mb'

// Agents reach this endpoint via whatever host works for them — LAN hostname,
// raw IP, Tailscale — so the transfer URLs in the instructions are derived
// from the request being served, never from a configured hostname.
function mcpBaseUrl(requestInfo?: Request) {
	try {
		if (requestInfo) {
			const url = new URL(requestInfo.url)
			// The adapter builds this URL from the raw Node request, which is
			// always http:// — TLS terminates at lan-ingress. Ingress stamps the
			// truthful scheme and host onto every proxied request (overwriting
			// anything the client sent), and umbreld's port is only reachable via
			// that loopback path, so the forwarded headers win over the URL parts.
			// Without this, HTTPS-connected agents would be told to curl their
			// bearer token over plaintext HTTP.
			const forwarded = (header: string) => requestInfo.headers.get(header)?.split(',')[0]?.trim() || undefined
			const protocol = forwarded('x-forwarded-proto') ?? url.protocol.replace(/:$/, '')
			const host = forwarded('x-forwarded-host') ?? url.host
			return `${protocol}://${host}/mcp`
		}
	} catch {
		// Fall through to the placeholder
	}
	return '<your MCP endpoint URL>'
}

function instructionsFor(permissions: McpPermissions, baseUrl: string) {
	const appAccess =
		permissions.apps === 'all'
			? 'all installed apps'
			: permissions.apps.length > 0
				? permissions.apps.join(', ')
				: 'not granted'
	const fileAccess =
		permissions.files === 'all'
			? '/Home, /External, and /Network'
			: permissions.files.length > 0
				? permissions.files.join(', ')
				: 'not granted'
	const appFiles =
		permissions.apps === 'all' || permissions.apps.length > 0
			? ' Granted app data is under /Apps. App root entries and lifecycle hooks are read-only; files inside other existing app directories remain writable.'
			: ''
	const hasFileAccess =
		permissions.files === 'all' ||
		permissions.files.length > 0 ||
		permissions.apps === 'all' ||
		permissions.apps.length > 0
	const filesUrl = `${baseUrl}/files`
	const machineAccess =
		permissions.machines === 'all'
			? 'all machines'
			: permissions.machines.length > 0
				? permissions.machines.join(', ')
				: 'not granted'
	const hasMachineGrants = permissions.machines === 'all' || permissions.machines.length > 0

	return [
		'This server controls the owner account on this umbrelOS device.',
		'Read-only system information, the installed app list, and the machine (virtual machine) list are always available.',
		`App control access: ${appAccess}.`,
		`File access: ${fileAccess}.${appFiles}`,
		`App Store access: ${permissions.appStore ? 'granted' : 'not granted'}.`,
		`System management: ${permissions.manageSystem ? 'granted' : 'not granted'}.`,
		`Machine control access: ${machineAccess}.`,
		`Machine creation: ${permissions.createMachines ? 'granted' : 'not granted'}.`,
		hasMachineGrants
			? 'Granted machines can be started, stopped, reconfigured, deleted, watched through get_machine_screenshot, and driven with keyboard and mouse through control_machine, which returns a fresh screenshot after every action. Deleting a machine permanently deletes its virtual disk.'
			: '',
		permissions.createMachines
			? 'create_machine returns immediately and installs in the background; follow list_machines until the machine is running with firstBootSetup false, then share its IP address and any credentials you set with the user. Machines you create are granted automatically.'
			: '',
		permissions.appStore
			? 'Before installing an app, ensure its dependencies (if any) are installed; pass alternatives when an installed implementing app satisfies a dependency.'
			: '',
		permissions.apps === 'all' || permissions.apps.length > 0
			? 'Uninstalling an app permanently deletes its app data; app data is not recoverable from Files Trash.'
			: '',
		'File deletion is available only by moving internal-storage items to Trash. Files in /External (USB storage) and /Network (Network storage) cannot be deleted through MCP because those locations require permanent deletion, which is unavailable.',
		"MCP never replaces an existing file. On a name conflict, ask the user whether to move the existing internal-storage item to Trash or keep both. For /External and /Network, use collision 'keep-both'; the response path is the generated copy name.",
		'File search, when available, covers only /Home.',
		hasFileAccess
			? `File contents transfer over HTTP, never through tool results. Download URL: ${filesUrl}/download?path=/Home/file.bin. Download example: curl -H "Authorization: Bearer <your token>" "${filesUrl}/download?path=/Home/file.bin" -o file.bin. Upload URL: ${filesUrl}/upload?path=/Home/file.bin. Upload example: curl -H "Authorization: Bearer <your token>" --data-binary @file.bin "${filesUrl}/upload?path=/Home/file.bin".`
			: '',
	]
		.filter(Boolean)
		.join(' ')
}

// The bearer credential names the agent: its label and type from settings,
// plus whatever the client last called itself
async function agentFor(umbreld: Umbreld, requestInfo?: Request) {
	const match = /^Bearer (.+)$/i.exec(requestInfo?.headers.get('authorization') ?? '')
	return match ? umbreld.mcp.describeAgent(match[1]) : undefined
}

export async function createUmbrelMcpServer(umbreld: Umbreld, requestInfo?: Request) {
	const permissions = await umbreld.mcp.getPermissions()
	const context = {
		rpc: createInternalTrpcCaller(umbreld),
		mcp: umbreld.mcp,
		dataDirectory: umbreld.dataDirectory,
		machines: umbreld.machines,
		agent: await agentFor(umbreld, requestInfo),
	} satisfies McpToolContext
	const server = new McpServer(
		{name: 'umbrelOS', version: umbreld.version},
		{instructions: instructionsFor(permissions, mcpBaseUrl(requestInfo))},
	)
	registerSystemInfoTools(server, context)
	registerAppTools(server, context, permissions)
	registerFileTools(server, context, permissions)
	if (permissions.manageSystem) registerSystemManagementTools(server, context)
	registerMachineTools(server, context, permissions)
	return server
}

export type McpEndpoint = {
	router: Router
	close: () => Promise<void>
}

type McpAuthentication = {token: string; tokenId: string}

function rejectUnauthorized(response: Response) {
	response.set('WWW-Authenticate', 'Bearer')
	response.status(401).json({
		jsonrpc: '2.0',
		error: {code: -32001, message: 'Unauthorized'},
		id: null,
	})
}

// Authentication runs once before a request body is accepted and again at
// the operation boundary. For JSON-RPC, the second lookup happens after the
// body is read, so a credential revoked during a slow upload cannot dispatch.
async function reauthenticate(umbreld: Umbreld, response: Response) {
	const authentication = response.locals.mcpAuthentication as McpAuthentication | undefined
	const current = authentication ? await umbreld.mcp.authenticateToken(authentication.token) : null
	if (!authentication || current?.tokenId !== authentication.tokenId) {
		rejectUnauthorized(response)
		return null
	}
	return current.tokenId
}

function mcpFilesGuard(umbreld: Umbreld): RequestHandler {
	return (request, response, next) => {
		void (async () => {
			const tokenId = await reauthenticate(umbreld, response)
			if (!tokenId) return

			try {
				if (request.method === 'POST' && request.query.collision === 'replace') {
					response.set('Connection', 'close')
					response.status(400).json({
						error:
							'collision=replace is not available through MCP. Ask the user whether to move an existing internal-storage item to Trash, or retry with collision=keep-both. Trash is unavailable for USB and network storage, so use keep-both there.',
					})
					return
				}
				const requestedPaths =
					typeof request.query.path === 'string'
						? [request.query.path]
						: Array.isArray(request.query.path)
							? request.query.path.map(String)
							: []
				// An upload writes into the containing directory, not only at the
				// requested path: the temporary .umbrel-upload file is staged there and
				// collision=keep-both renames the result to a sibling. Granting the
				// directory keeps both inside the grant — uploading onto a grant root
				// would otherwise land its sibling in the grant's parent. The parent is
				// taken after normalization because that is what the destination
				// resolves through: '/Home/photos/.' is the grant root, not a child.
				if (request.method === 'POST') {
					const normalizedPaths = requestedPaths.map((path) => umbreld.mcp.normalizeFilePath(path))
					await Promise.all([
						...normalizedPaths.map((path) => umbreld.mcp.assertFileWriteAccess(path)),
						...normalizedPaths.map((path) => umbreld.mcp.assertFileAccess(nodePath.posix.dirname(path))),
					])
				} else {
					await Promise.all(requestedPaths.map((path) => umbreld.mcp.assertFileAccess(path)))
				}
				response.locals.principal = {
					sessionId: 'system',
					accountId: OWNER_ACCOUNT_ID,
					actor: 'system',
				} satisfies Principal
				umbreld.mcp.recordRequest(tokenId)
				umbreld.mcp.logger.log(`Handling MCP file ${request.method === 'GET' ? 'download' : 'upload'}`)
				next()
			} catch {
				if (request.method === 'POST') response.set('Connection', 'close')
				response.status(403).json({error: `permission denied. ${MCP_PERMISSION_REMEDIATION}`})
			}
		})().catch(next)
	}
}

export default function createMcpEndpoint(umbreld: Umbreld, uploadDiskPreflight: UploadDiskPreflight): McpEndpoint {
	const router = express.Router()
	const handler = createMcpHandler((ctx) => createUmbrelMcpServer(umbreld, ctx.requestInfo), {
		legacy: 'stateless',
		onerror: (error) => umbreld.mcp.logger.error('MCP request failed', error),
	})
	const nodeHandler = toNodeHandler(handler, {
		onerror: (error) => umbreld.mcp.logger.error('MCP adapter failed', error),
	})

	const authorize: RequestHandler = (request, response, next) => {
		void (async () => {
			const match = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')
			const authentication = match ? await umbreld.mcp.authenticateToken(match[1]) : null
			// Disabled MCP and invalid credentials intentionally return the same
			// response so unauthenticated callers cannot probe whether MCP is enabled.
			if (!match || !authentication) {
				rejectUnauthorized(response)
				return
			}

			response.locals.mcpAuthentication = {token: match[1], tokenId: authentication.tokenId} satisfies McpAuthentication
			response.set('Cache-Control', 'no-store')
			next()
		})().catch(next)
	}

	router.use(authorize)
	router.get('/files/download', mcpFilesGuard(umbreld), downloadFiles(umbreld))
	router.post('/files/upload', mcpFilesGuard(umbreld), uploadFile(umbreld, uploadDiskPreflight))
	// JSON-RPC bodies are parsed here rather than by the adapter so the agent's
	// self-declared identity can be captured for the dashboard; the adapter
	// accepts the pre-parsed body. File transfers above stream raw and stay
	// untouched by this parser. Non-strict so valid primitive JSON reaches the
	// adapter, which classifies it as an invalid request rather than a parse
	// error — matching what it does when it parses raw bodies itself.
	router.use(
		express.json({
			limit: BODY_LIMIT,
			strict: false,
			// Fires only when the parser actually read bytes — ground truth for
			// "did this request carry a body". Headers can lie: a zero-byte
			// chunked request has Transfer-Encoding but no content.
			verify: (request, _response, rawBody) => {
				;(request as {hasRawBody?: boolean}).hasRawBody = rawBody.length > 0
			},
		}),
	)
	// The parser above reads only application/json. Any other content type would
	// reach the adapter unread, and it buffers the whole stream into a string
	// before rejecting the type, so those bodies are read here under the same
	// cap. The adapter still answers 415, now from a drained stream.
	router.use(express.raw({type: () => true, limit: BODY_LIMIT}))
	router.use((request, response, next) => {
		// An empty body parses to {} here, but must stay with the adapter's raw
		// path so it keeps classifying as a parse error
		const hasBody = (request as {hasRawBody?: boolean}).hasRawBody === true
		const body = request.method === 'POST' && hasBody ? request.body : undefined
		void (async () => {
			const tokenId = await reauthenticate(umbreld, response)
			if (!tokenId) return
			umbreld.mcp.recordRequest(tokenId, body)
			await nodeHandler(request, response, body)
		})().catch(next)
	})
	// This handler sees every upstream failure, not just parser errors: only
	// genuine JSON syntax errors answer as a JSON-RPC parse error, other
	// body-parser rejections (size, charset) keep their HTTP status, and
	// anything else is a server-side failure
	router.use(((error, request, response, next) => {
		if (response.headersSent) return next(error)
		const {type, status} = error as {type?: string; status?: number}
		if (type === 'entity.parse.failed') {
			response.status(400).json({jsonrpc: '2.0', error: {code: -32700, message: 'Parse error'}, id: null})
			return
		}
		if (typeof status === 'number' && status >= 400 && status < 500) {
			response.status(status).json({jsonrpc: '2.0', error: {code: -32600, message: 'Invalid Request'}, id: null})
			return
		}
		umbreld.mcp.logger.error('MCP request handling failed', error)
		response.status(500).json({jsonrpc: '2.0', error: {code: -32603, message: 'Internal error'}, id: null})
	}) as ErrorRequestHandler)

	return {router, close: handler.close}
}
