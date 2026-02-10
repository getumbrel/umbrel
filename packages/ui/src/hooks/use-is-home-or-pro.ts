import {useDeviceInfo} from '@/hooks/use-device-info'
import {t} from '@/utils/i18n'

// Consider consolidating device detection hooks. Currently we have:
// - useIsUmbrelHome (uses trpcReact.migration.isUmbrelHome)
// - useIsUmbrelPro (uses trpcReact.hardware.umbrelPro.isUmbrelPro)
// - useDeviceInfo (uses trpcReact.system.device)
// - useIsHomeOrPro (uses useDeviceInfo)
// These could potentially be unified into a single source of truth.
export function useIsHomeOrPro() {
	const {isLoading, data} = useDeviceInfo()
	const isUmbrelHome = data?.umbrelHostEnvironment === 'umbrel-home'
	const isUmbrelPro = data?.umbrelHostEnvironment === 'umbrel-pro'
	const isHomeOrPro = isUmbrelHome || isUmbrelPro
	const deviceName = isUmbrelPro ? 'Umbrel Pro' : isUmbrelHome ? 'Umbrel Home' : t('device-name.home-or-pro')

	return {
		isHomeOrPro,
		isLoading,
		deviceName,
		isUmbrelPro,
		isUmbrelHome,
	}
}
