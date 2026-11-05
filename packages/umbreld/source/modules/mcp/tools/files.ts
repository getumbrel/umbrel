import nodePath from 'node:path'

import type {McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import type {McpPermissions} from '../mcp.ts'
import {MCP_PERMISSION_REMEDIATION, runTool, type McpToolContext} from './shared.ts'

type FileDto = {
	name: string
	path: string
	type: string
	size?: number
	modified: number
}

function fileDto(file: FileDto): FileDto {
	return {
		name: file.name,
		path: file.path,
		type: file.type,
		size: file.size,
		modified: file.modified,
	}
}

// Numeric collation, so a cursor walks the listing in the order an agent sees.
// The collator reports distinct names as equal ('1.txt' and '01.txt', or NFC and
// NFD spellings of the same name), so ties break on the raw name: without a
// total order the sort is unstable between pages and the cursor skips whole
// entries.
const collator = new Intl.Collator('en-US', {numeric: true})

function compareNames(first: string, second: string) {
	return collator.compare(first, second) || (first < second ? -1 : first > second ? 1 : 0)
}

function paginate<Entry extends {name: string}>(entries: Entry[], lastFile: string | undefined, limit: number) {
	entries.sort((first, second) => compareNames(first.name, second.name))
	// The cursor resolves positionally rather than by exact match, so a page
	// still advances when the file the agent last saw has since been moved,
	// renamed or trashed instead of silently restarting at the first page
	const lastFileIndex = lastFile ? entries.findIndex(({name}) => compareNames(name, lastFile) > 0) : 0
	const start = lastFileIndex === -1 ? entries.length : lastFileIndex
	return {
		files: entries.slice(start, start + limit),
		totalFiles: entries.length,
		hasMore: start + limit < entries.length,
	}
}

async function effectiveGrants(context: McpToolContext) {
	const grants = await context.mcp.allowedFileGrants()
	return grants.filter((candidate) => !grants.some((grant) => grant !== candidate && candidate.startsWith(`${grant}/`)))
}

function collisionError(error: unknown, toDirectory: string): never {
	if (!(error instanceof Error) || !error.message.includes('[destination-already-exists]')) throw error
	const trashUnavailable = ['/External', '/Network'].some(
		(base) => toDirectory === base || toDirectory.startsWith(`${base}/`),
	)
	if (trashUnavailable) {
		throw new Error(
			"[destination-already-exists] Replacement is not available through MCP, and USB/network items cannot be moved to Trash. Retry with collision 'keep-both'; the returned path will show the generated copy name.",
		)
	}
	throw new Error(
		"[destination-already-exists] Replacement is not available through MCP. Ask the user whether to move the existing destination to Trash, or retry with collision 'keep-both'.",
	)
}

function transferResult(source: string, toDirectory: string, resultPath: string) {
	const requestedPath = nodePath.posix.join(toDirectory, nodePath.posix.basename(source))
	return {
		path: resultPath,
		...(resultPath !== requestedPath
			? {
					note: `The destination already existed, so the item was saved as '${resultPath}' and the original was unchanged.`,
				}
			: {}),
	}
}

export default function registerFileTools(server: McpServer, context: McpToolContext, permissions: McpPermissions) {
	const initialGrants =
		permissions.files === 'all' ||
		permissions.files.length > 0 ||
		permissions.apps === 'all' ||
		permissions.apps.length > 0
	if (!initialGrants) return

	server.registerTool(
		'list_directory',
		{
			title: 'List directory',
			description:
				'List a granted directory. The synthetic / root lists only effective file grants and granted app-data roots.',
			inputSchema: z.object({
				path: z.string().default('/').describe('An umbrelOS virtual path, such as /Home/Documents.'),
				lastFile: z
					.string()
					.optional()
					.describe(
						'The final file name from the previous page. Listing resumes at the first name sorting after it, so paging still advances if that file has been moved, renamed or trashed.',
					),
				limit: z.number().int().min(1).max(250).default(100).describe('Maximum files to return.'),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'list_directory', input, async () => {
				const path = context.mcp.normalizeFilePath(input.path)
				if (path === '/') {
					const grants = await effectiveGrants(context)
					const files = await Promise.all(
						grants.map(async (grant) => {
							await context.mcp.assertFileAccess(grant)
							return fileDto(await context.rpc.files.status({path: grant}))
						}),
					)
					return {path: '/', ...paginate(files, input.lastFile, input.limit)}
				}

				await context.mcp.assertFileAccess(path)
				const {files, ...directory} = await context.rpc.files.listDirectoryPage({
					path,
					lastFile: input.lastFile,
					limit: input.limit,
				})
				return {
					...fileDto(directory),
					files: files.map(fileDto),
					totalFiles: directory.totalFiles,
					hasMore: directory.hasMore,
					...(directory.truncatedAt ? {truncatedAt: directory.truncatedAt} : {}),
				}
			}),
	)

	server.registerTool(
		'create_directory',
		{
			title: 'Create directory',
			description: 'Create one directory within a granted path. Its parent directory must already exist.',
			inputSchema: z.object({path: z.string().describe('The virtual path of the directory to create.')}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'create_directory', input, async () => {
				const {path} = await context.mcp.assertFileWriteAccess(input.path)
				return {path, ...(await context.rpc.files.createDirectory({path}))}
			}),
	)

	const transferInput = z.object({
		path: z.string().describe('The granted source file or directory.'),
		toDirectory: z.string().describe('The granted destination directory.'),
		collision: z
			.enum(['error', 'keep-both'])
			.default('error')
			.describe(
				"Use 'error' to leave an existing destination unchanged or 'keep-both' to save under a generated sibling name. Replacement is not available through MCP.",
			),
	})

	server.registerTool(
		'copy',
		{
			title: 'Copy file or directory',
			description:
				"Copy a granted file or directory without replacing existing data. On a name conflict, ask the user whether to move the existing internal-storage item to Trash or use collision 'keep-both'. USB/network items cannot be trashed, so use 'keep-both' there. The response path is the actual saved name.",
			inputSchema: transferInput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'copy', input, async () => {
				const [{path}, {path: toDirectory}] = await Promise.all([
					context.mcp.assertFileAccess(input.path),
					context.mcp.assertFileAccess(input.toDirectory),
				])
				await context.mcp.assertFileWriteAccess(nodePath.posix.join(toDirectory, nodePath.posix.basename(path)))
				const resultPath = await context.rpc.files
					.copy({path, toDirectory, collision: input.collision})
					.catch((error) => collisionError(error, toDirectory))
				return transferResult(path, toDirectory, resultPath)
			}),
	)

	server.registerTool(
		'move',
		{
			title: 'Move file or directory',
			description:
				"Move a granted file or directory without replacing existing data. On a name conflict, ask the user whether to move the existing internal-storage item to Trash or use collision 'keep-both'. USB/network items cannot be trashed, so use 'keep-both' there. The response path is the actual saved name.",
			inputSchema: transferInput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'move', input, async () => {
				const [{path}, {path: toDirectory}] = await Promise.all([
					context.mcp.assertFileWriteAccess(input.path),
					context.mcp.assertFileAccess(input.toDirectory),
				])
				await context.mcp.assertFileWriteAccess(nodePath.posix.join(toDirectory, nodePath.posix.basename(path)))
				const resultPath = await context.rpc.files
					.move({path, toDirectory, collision: input.collision})
					.catch((error) => collisionError(error, toDirectory))
				return transferResult(path, toDirectory, resultPath)
			}),
	)

	server.registerTool(
		'rename',
		{
			title: 'Rename file or directory',
			description: 'Rename a granted file or directory without moving it to another parent.',
			inputSchema: z.object({
				path: z.string().describe('The granted source file or directory.'),
				name: z.string().min(1).describe('The new base name.'),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'rename', input, async () => {
				const {path} = await context.mcp.assertFileWriteAccess(input.path)
				const destination = nodePath.posix.join(nodePath.posix.dirname(path), input.name)
				await context.mcp.assertFileWriteAccess(destination)
				return {path: await context.rpc.files.rename({path, newName: input.name})}
			}),
	)

	server.registerTool(
		'trash',
		{
			title: 'Move to Trash',
			description:
				'Move a granted internal-storage file or directory to the owner Trash. USB and network storage cannot be deleted through MCP because they require permanent deletion, which is unavailable.',
			inputSchema: z.object({path: z.string().describe('The granted file or directory to move to Trash.')}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'trash', input, async () => {
				const {path} = await context.mcp.assertFileWriteAccess(input.path)
				return {path: await context.rpc.files.trash({path})}
			}),
	)

	if (permissions.files === 'all' || permissions.files.includes('/Home')) {
		server.registerTool(
			'search_files',
			{
				title: 'Search Home files',
				description: 'Fuzzy-search file names across /Home. This tool is available only with full Home access.',
				inputSchema: z.object({
					query: z.string().min(1).describe('The file name or partial file name to find.'),
					limit: z.number().int().min(1).max(250).default(50),
				}),
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			(input) =>
				runTool(context, 'search_files', input, async () => {
					if (!(await context.mcp.hasFullHomeAccess())) {
						throw new Error(
							`[permission-denied] Full /Home access is required for search. ${MCP_PERMISSION_REMEDIATION}`,
						)
					}
					return (await context.rpc.files.search({query: input.query, maxResults: input.limit})).map(fileDto)
				}),
		)
	}
}
