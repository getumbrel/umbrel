import {t} from '@/utils/i18n'

export const appStateToLabel = {
	'not-installed': t('app.install'),
	installing: t('app.installing'),
	ready: t('app.open'),
	running: t('app.open'),
	starting: t('app.restarting'),
	restarting: t('app.starting'),
	stopping: t('app.stopping'),
	updating: t('app.updating'),
	uninstalling: t('app.uninstalling'),
	unknown: t('app.offline'),
	stopped: t('app.offline'),
	loading: t('loading'),
} as const
