export const title = 'Factory reset'
export const description = 'Delete all data, and reset your device completely'

export const backPath = '/settings?dialog=factory-reset'

export function factoryResetTitle(subtitle: string) {
	return `${subtitle} - ${title}`
}
