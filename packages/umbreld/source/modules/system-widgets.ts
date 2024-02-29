import prettyBytes from 'pretty-bytes'

import type Umbreld from '../index.js'
import { getDiskUsage, getMemoryUsage, getCpuUsage } from './system.js'

export const systemWidgets = {
  storage: async function(umbreld: Umbreld) {
    const {size, totalUsed} = await getDiskUsage(umbreld)

    return {
      type: 'stat-with-progress',
      link: '?dialog=live-usage',
      refresh: '30s',
      title: 'Storage',
      value: prettyBytes(totalUsed),
      progressLabel: `${prettyBytes(size - totalUsed)} left`,
      progress: ( totalUsed / size ).toFixed(2),
    }
  },
  memory: async function(umbreld: Umbreld) {
    const {size, totalUsed} = await getMemoryUsage(umbreld)

    return {
      type: 'stat-with-progress',
      link: '?dialog=live-usage',
      refresh: '10s',
      title: 'Memory',
      value: prettyBytes(totalUsed),
      valueSub: prettyBytes(size),
      progressLabel: `${prettyBytes(size - totalUsed)} left`,
      progress: ( totalUsed / size ).toFixed(2),
    }
  },
	'system-stats': async function(umbreld: Umbreld) {
		const [cpuUsage, diskUsage, memoryUsage] = await Promise.all([
      getCpuUsage(umbreld),
      getDiskUsage(umbreld),
      getMemoryUsage(umbreld)
    ]);
  
    const { totalUsed: cpuTotalUsed } = cpuUsage;
    const {size: diskSize, totalUsed: diskTotalUsed} = diskUsage;
    const {size: memorySize, totalUsed: memoryTotalUsed} = memoryUsage;
  
    return {
      type: 'three-up',
      link: '?dialog=live-usage',
      refresh: '10s',
      items: [
        {
          icon: 'system-widget-cpu',
          title: 'CPU',
          value: `${cpuTotalUsed.toPrecision(2)}%`,
        },
        {
          icon: 'system-widget-storage',
          title: 'Free',
          value: `${prettyBytes(diskSize - diskTotalUsed)}`,
        },
        {
          icon: 'system-widget-memory',
          title: 'Memory',
          value: `${prettyBytes(memorySize - memoryTotalUsed)}`,
        }
      ]
    }
	}
}