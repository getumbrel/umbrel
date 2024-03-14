import prettyBytes from 'pretty-bytes'

import type Umbreld from '../index.js'
import {getDiskUsage, getMemoryUsage, getCpuUsage} from './system.js'

export const systemWidgets = {
	storage: async function (umbreld: Umbreld) {
		const {size, totalUsed} = await getDiskUsage(umbreld)

		return {
			type: 'text-with-progress',
			link: '?dialog=live-usage',
			refresh: '30s',
			title: 'Storage',
			text: prettyBytes(totalUsed),
			subtext: `/ ${prettyBytes(size)}`,
			progressLabel: `${prettyBytes(size - totalUsed)} left`,
			progress: (totalUsed / size).toFixed(2),
		}
	},
	memory: async function (umbreld: Umbreld) {
		const {size, totalUsed} = await getMemoryUsage(umbreld)

		return {
			type: 'text-with-progress',
			link: '?dialog=live-usage',
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
			getDiskUsage(umbreld),
			getMemoryUsage(umbreld),
		])

		const {totalUsed: cpuTotalUsed} = cpuUsage
		const {totalUsed: diskTotalUsed} = diskUsage
		const {totalUsed: memoryTotalUsed} = memoryUsage

		return {
			type: 'three-stats',
			link: '?dialog=live-usage',
			refresh: '10s',
			items: [
				{
					icon: 'system-widget-storage',
					subtext: 'Storage',
					text: `${prettyBytes(diskTotalUsed)}`,
				},
				{
					icon: 'system-widget-memory',
					subtext: 'Memory',
					text: `${prettyBytes(memoryTotalUsed)}`,
				},
				{
					icon: 'system-widget-cpu',
					subtext: 'CPU',
					text: `${cpuTotalUsed.toPrecision(2)}%`,
				},
			],
		}
	},
}
