import type {WebSocket} from 'ws'

// One close code for every socket that no longer belongs to the controlling
// console, so browsers stop instead of retrying. Audio reopens with the console.
export const MACHINE_CONSOLE_SUPERSEDED_CODE = 4001
export const MACHINE_CONSOLE_SUPERSEDED_REASON = 'Superseded by another console'
export const MACHINE_CONSOLE_RELEASED_REASON = 'Console closed'

type MachineConsoleSession = {
	id: string
	console: WebSocket
	audio?: WebSocket
}

export default class MachineConsoleSessions {
	#sessions = new Map<string, MachineConsoleSession>()

	claimConsole(machineId: string, sessionId: string, console: WebSocket) {
		const previous = this.#sessions.get(machineId)
		this.#sessions.set(machineId, {id: sessionId, console})
		const previousConsole = previous?.console
		if (previousConsole && previousConsole !== console && previousConsole.readyState === previousConsole.OPEN) {
			previousConsole.close(MACHINE_CONSOLE_SUPERSEDED_CODE, MACHINE_CONSOLE_SUPERSEDED_REASON)
		}
		const previousAudio = previous?.audio
		if (previousAudio && previousAudio.readyState === previousAudio.OPEN) {
			previousAudio.close(MACHINE_CONSOLE_SUPERSEDED_CODE, MACHINE_CONSOLE_SUPERSEDED_REASON)
		}
	}

	releaseConsole(machineId: string, sessionId: string, console: WebSocket) {
		const current = this.#sessions.get(machineId)
		if (current?.id !== sessionId || current.console !== console) return
		this.#sessions.delete(machineId)
		const audio = current.audio
		if (audio && audio.readyState === audio.OPEN) {
			audio.close(MACHINE_CONSOLE_SUPERSEDED_CODE, MACHINE_CONSOLE_RELEASED_REASON)
		}
	}

	hasConsole(machineId: string, sessionId: string) {
		const current = this.#sessions.get(machineId)
		return current?.id === sessionId && current.console.readyState === current.console.OPEN
	}

	attachAudio(machineId: string, sessionId: string, audio: WebSocket) {
		const current = this.#sessions.get(machineId)
		if (current?.id !== sessionId || current.console.readyState !== current.console.OPEN) return false
		if (current.audio && current.audio !== audio && current.audio.readyState === current.audio.OPEN) {
			current.audio.close(MACHINE_CONSOLE_SUPERSEDED_CODE, MACHINE_CONSOLE_SUPERSEDED_REASON)
		}
		current.audio = audio
		return true
	}

	releaseAudio(machineId: string, sessionId: string, audio: WebSocket) {
		const current = this.#sessions.get(machineId)
		if (current?.id === sessionId && current.audio === audio) delete current.audio
	}
}
