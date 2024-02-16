import {t} from '@/utils/i18n'

// In a function because otherwise translation won't always work
// Could also put into a hook or component
export const title = () => t('factory-reset')
export const description = () => t('factory-reset.desc')

export const backPath = '/settings?dialog=factory-reset'

export function factoryResetTitle(subtitle: string) {
	return `${subtitle} - ${title}`
}
