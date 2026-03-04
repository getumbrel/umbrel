import prettyBytes from 'pretty-bytes'

import type Umbreld from '../../index.js'
import {getSystemDiskUsage, getSystemMemoryUsage, getCpuUsage} from './system.js'

export const systemWidgets = {
	storage: async function (umbreld: Umbreld) {
		const {size, totalUsed} = await getSystemDiskUsage(umbreld)

		return {
			type: 'text-with-progress',
			link: '?dialog=live-usage&tab=storage',
			refresh: '30s',
			title: 'Storage',
			text: prettyBytes(totalUsed),
			subtext: `/ ${prettyBytes(size)}`,
			progressLabel: `${prettyBytes(size - totalUsed)} left`,
			progress: (totalUsed / size).toFixed(2),
		}
	},
	memory: async function (umbreld: Umbreld) {
		const {size, totalUsed} = await getSystemMemoryUsage()

		return {
			type: 'text-with-progress',
			link: '?dialog=live-usage&tab=memory',
			refresh: '10s',
			title: 'Memory',
			text: prettyBytes(totalUsed),
			subtext: `/ ${prettyBytes(size)}`,
			progressLabel: `${prettyBytes(size - totalUsed)} left`,
			progress: (totalUsed / size).toFixed(2),
		}
	},
	'system-stats': async function (umbreld: Umbreld) {
		const [cpuUsage, diskUsage, memoryUsage] = await Promise.all([
			getCpuUsage(umbreld),
			getSystemDiskUsage(umbreld),
			getSystemMemoryUsage(),
		])

		const {totalUsed: cpuTotalUsed} = cpuUsage
		const {totalUsed: diskTotalUsed} = diskUsage
		const {totalUsed: memoryTotalUsed} = memoryUsage

		// Formats CPU usage to avoid scientific notation for usage >= 99.5% (e.g., 1.0e+2%)
		// and sets upper limit to 100% because we are calculating usage as a % of total system, not % of a single thread
		const formatCpuUsage = (usage: number) => {
			if (usage >= 99.5) return '100%'
			return `${usage.toPrecision(2)}%`
		}

		return {
			type: 'three-stats',
			link: '?dialog=live-usage',
			refresh: '10s',
			items: [
				{
					icon: 'system-widget-cpu',
					subtext: 'CPU',
					text: formatCpuUsage(cpuTotalUsed),
				},
				{
					icon: 'system-widget-memory',
					subtext: 'Memory',
					text: `${prettyBytes(memoryTotalUsed)}`,
				},
				{
					icon: 'system-widget-storage',
					subtext: 'Storage',
					text: `${prettyBytes(diskTotalUsed)}`,
				},
			],
		}
	},
}
