// The storage's headline, for everything outside Storage Manager that talks about it. See
// ../headline.ts for what it says.

import {useTranslation} from 'react-i18next'

import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {useIsUmbrelPro} from '@/hooks/use-is-umbrel-pro'
import {trpcReact} from '@/trpc/trpc'

import {getHeadline, Headline} from '../headline'
import type {SingleHost} from '../single-status'

// What umbrelOS runs on, where it keeps everything on the drive it starts from
export function toSingleHost(identity: {productName: string} | undefined): SingleHost {
	const environment = deviceInfoToHostEnvironment(identity)
	if (!environment) return 'unknown'
	if (environment === 'umbrel-home') return 'home'
	if (environment === 'raspberry-pi') return 'pi'
	if (environment === 'docker-container') return 'container'
	return 'other'
}

// Reads what the app already has cached about the storage. The island keeps that fresh while a
// task runs, and umbreld's events refresh it when the storage changes.
export function useStorageHeadline({enabled = true}: {enabled?: boolean} = {}): Headline | null {
	const {t, i18n} = useTranslation()
	const identity = useIsUmbrelPro({enabled})
	const raidQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {enabled})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {enabled})
	// Only a machine without storage of its own is worded by what it is
	const single = enabled && !!raidQ.data && !raidQ.data.exists && !raidQ.data.name && !identity.isUmbrelPro
	const identityQ = trpcReact.systemNg.device.getIdentity.useQuery(undefined, {enabled: single})

	if (!enabled || !identity.hasData) return null
	return getHeadline({
		raid: raidQ.data,
		devices: devicesQ.data,
		isPro: identity.isUmbrelPro,
		host: toSingleHost(identityQ.data),
		t,
		locale: i18n.language,
	})
}
