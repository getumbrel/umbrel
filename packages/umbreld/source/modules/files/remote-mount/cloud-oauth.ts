import {randomBytes} from 'node:crypto'

import {type ExecaChildProcess, execa} from 'execa'

export type CloudOAuthProvider = 'dropbox' | 'google_drive'

const SESSION_TTL_MS = 15 * 60 * 1000

type CloudOAuthSession = {
	provider: CloudOAuthProvider
	authUrl: string
	child: ExecaChildProcess
	tokenPromise: Promise<string>
	createdAt: number
	status: 'pending' | 'complete' | 'failed'
	token?: string
}

const sessions = new Map<string, CloudOAuthSession>()

function rcloneProviderName(provider: CloudOAuthProvider) {
	return provider === 'google_drive' ? 'drive' : provider
}

export function parseCloudAuthUrl(output: string) {
	const match =
		output.match(/Please go to the following link:\s*(https?:\/\/\S+)/i) ??
		output.match(/(https?:\/\/127\.0\.0\.1:\d+\/auth\?\S+)/)
	if (!match) throw new Error('[cloud-auth-url-not-found]')
	return match[1]!.replace(/:$/, '')
}

export function parseCloudAuthToken(stdout: string) {
	const trimmed = stdout.trim()
	if (trimmed.startsWith('{')) {
		JSON.parse(trimmed)
		return trimmed
	}

	const match = stdout.match(/\{[\s\S]*\}/)
	if (!match) throw new Error('[cloud-auth-token-not-found]')

	JSON.parse(match[0])
	return match[0]
}

function cleanupExpiredSessions() {
	const now = Date.now()
	for (const [sessionId, session] of sessions) {
		if (now - session.createdAt <= SESSION_TTL_MS) continue
		session.child.kill('SIGTERM', {forceKillAfterTimeout: 1000})
		sessions.delete(sessionId)
	}
}

export async function startCloudOAuth(provider: CloudOAuthProvider) {
	cleanupExpiredSessions()

	const sessionId = randomBytes(16).toString('hex')
	const child = execa('rclone', ['authorize', rcloneProviderName(provider), '--auth-no-open-browser'], {
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	})

	let stderrBuffer = ''
	const authUrl = await new Promise<string>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('[cloud-auth-timeout]')), 30_000)

		const onData = (chunk: Buffer | string) => {
			stderrBuffer += chunk.toString()
			try {
				const url = parseCloudAuthUrl(stderrBuffer)
				clearTimeout(timeout)
				child.stderr?.off('data', onData)
				resolve(url)
			} catch {
				// Keep waiting for the full authorize URL in rclone logs.
			}
		}

		child.stderr?.on('data', onData)
		child.on('error', (error) => {
			clearTimeout(timeout)
			reject(error)
		})
		child.on('exit', (code) => {
			if (code === 0) return
			clearTimeout(timeout)
			reject(new Error('[cloud-auth-failed]'))
		})
	})

	const session: CloudOAuthSession = {
		provider,
		authUrl,
		child,
		tokenPromise: child.then((result) => parseCloudAuthToken(result.stdout)),
		createdAt: Date.now(),
		status: 'pending',
	}

	session.tokenPromise
		.then((token) => {
			session.status = 'complete'
			session.token = token
		})
		.catch(() => {
			session.status = 'failed'
		})

	sessions.set(sessionId, session)

	return {sessionId, authUrl}
}

export async function getCloudOAuthStatus(sessionId: string) {
	const session = sessions.get(sessionId)
	if (!session) throw new Error('[invalid-oauth-session]')

	if (session.status === 'complete' && session.token) {
		return {status: 'complete' as const, token: session.token}
	}

	if (session.status === 'failed') throw new Error('[cloud-auth-failed]')

	if (session.child.exitCode !== null) {
		const token = await session.tokenPromise
		session.status = 'complete'
		session.token = token
		return {status: 'complete' as const, token}
	}

	return {status: 'pending' as const, authUrl: session.authUrl}
}

export function consumeCloudOAuthToken(sessionId: string) {
	const session = sessions.get(sessionId)
	if (!session || session.status !== 'complete' || !session.token) {
		throw new Error('[invalid-oauth-session]')
	}

	const token = session.token
	sessions.delete(sessionId)
	session.child.kill('SIGTERM', {forceKillAfterTimeout: 1000})
	return token
}
