import {promisify} from 'node:util'
import {exec} from 'node:child_process'
import {platform} from 'node:process'

const execAsync = promisify(exec)

export const shutdown = async ({restart = false} = {}) => {
	if (!['linux', 'darwin'].includes(platform)) throw new Error('Unsupported platform')
	try {
		// TODO: echoing the command for now
		const result = await execAsync(`echo "sudo shutdown ${restart ? '-r' : '-h'} now"`)
		console.log(`[Simulated] ${restart ? 'Restarting' : 'Shutting down'} the system with: ${result.stdout}`)
	} catch (error) {
		throw new Error(`Unable to ${restart ? 'restart' : 'shut down'} the system: ${error.message}`)
	}
}

export const restart = async () => shutdown({restart: true})
