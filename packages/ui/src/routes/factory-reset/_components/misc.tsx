import {t} from '@/utils/i18n'

// In a function because otherwise translation won't always work
// Could also put into a hook or component
export const title = () => t('factory-reset')
export const description = () => t('factory-reset-description')

export const backPath = '/settings'
