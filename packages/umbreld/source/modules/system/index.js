import UmbrelModule from '../umbrel-module.js'
import * as systemMonitor from '../../utilities/system-monitor.js'
import * as systemCommands from '../../utilities/system-commands.js'

// TODO: The system module is responsible for:
// - Issuing system commands like shutdown/restart
// - Monitoring system sensors/metrics
// - Installing security patches on the host
class System extends UmbrelModule {
	async getCpuTemperature() {
		return systemMonitor.getCpuTemperature()
	}

	async getDiskUsage(umbreldDataDir) {
		return systemMonitor.getDiskUsage(umbreldDataDir)
	}

	async getMemoryUsage() {
		return systemMonitor.getMemoryUsage()
	}

	async shutdown() {
		return systemCommands.shutdown()
	}

	async restart() {
		return systemCommands.restart()
	}
}

export default System
