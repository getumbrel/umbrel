import {execSync, spawn} from 'child_process'
import process from 'process'

export function resetUmbreldAndStart(): Promise<() => void> {
	console.log('running...')

	execSync('cd ../umbreld && rm -rf data && mkdir data')

	const child = spawn('npm', ['run', 'dev'], {cwd: '../umbreld'})

	return new Promise((resolve, reject) => {
		child.on('error', reject)
		child.stdout.on('data', (data) => {
			console.log(data.toString())
			if (data.toString().includes('Repositories initialised!')) {
				const stop = () => child.pid && process.kill(child.pid, 'SIGINT')
				resolve(stop)
				console.log('Initialized')
				// process.exit(0)
			}
		})
	})
}
