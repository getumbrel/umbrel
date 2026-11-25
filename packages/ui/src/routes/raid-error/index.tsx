// Shown in place of login when the storage couldn't start. The screen is in
// features/storage/start-failure: this gives it what umbreld reports to someone who isn't
// signed in, which is the drives the storage is built from and whether each one answered.

import {useTranslation} from 'react-i18next'
import {Navigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {toStartFailureDrives} from '@/features/storage/from-umbreld'
import {StartFailure} from '@/features/storage/start-failure'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {temperatureUnitFromLocale} from '@/hooks/use-temperature-unit'
import {OnboardingPage} from '@/layouts/bare/onboarding-page'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {trpcReact} from '@/trpc/trpc'

export default function RaidErrorScreen() {
	const {t} = useTranslation()
	const mountFailureQ = trpcReact.hardware.raid.checkRaidMountFailure.useQuery(undefined, {retry: false})
	const failed = mountFailureQ.data === true
	const raidDevicesQ = trpcReact.hardware.raid.checkRaidMountFailureDevices.useQuery(undefined, {
		enabled: failed,
		retry: false,
	})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		enabled: failed,
		retry: false,
	})
	// The one way to tell an Umbrel Pro apart that needs no owner token
	const identityQ = trpcReact.systemNg.device.getIdentity.useQuery(undefined, {
		enabled: failed,
		retry: false,
	})
	const isPro = deviceInfoToHostEnvironment(identityQ.data) === 'umbrel-pro'
	const {restart, shutdown, isPowerActionPending} = useGlobalSystemState()
	const factoryResetMut = trpcReact.system.factoryReset.useMutation({
		onError: (error) => {
			toast.error(t('raid-error.factory-reset-failed'), {area: 'umbrelos', description: error.message})
		},
	})

	const checkAgain = () => {
		void mountFailureQ.refetch()
		if (failed) {
			void raidDevicesQ.refetch()
			void devicesQ.refetch()
			void identityQ.refetch()
		}
	}

	// The storage started after all
	if (mountFailureQ.data === false && !mountFailureQ.isError) return <Navigate to='/' replace />

	const checkError = mountFailureQ.error ?? devicesQ.error ?? raidDevicesQ.error ?? identityQ.error

	return (
		<OnboardingPage>
			<StartFailure
				device={isPro ? 'pro' : 'other'}
				drives={toStartFailureDrives({
					members: raidDevicesQ.data ?? [],
					membersKnown: !raidDevicesQ.isError,
					devices: devicesQ.data ?? [],
					devicesKnown: !devicesQ.isError,
					isPro,
				})}
				loading={mountFailureQ.isLoading || devicesQ.isLoading || raidDevicesQ.isLoading}
				unconfirmed={!failed}
				checkError={checkError?.message}
				checking={mountFailureQ.isFetching || raidDevicesQ.isFetching || devicesQ.isFetching || identityQ.isFetching}
				busy={isPowerActionPending || factoryResetMut.isPending}
				onCheckAgain={checkAgain}
				onRestart={() => restart()}
				onShutdown={() => shutdown()}
				onFactoryReset={() => factoryResetMut.mutate({})}
				// Nobody is signed in, so there is no saved preference to read
				temperatureUnit={temperatureUnitFromLocale(navigator.language)}
				footerStart={<LanguageDropdown />}
			/>
		</OnboardingPage>
	)
}
