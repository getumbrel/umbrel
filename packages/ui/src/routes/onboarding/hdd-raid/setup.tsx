// Creates the storage chosen at /onboarding/hdd-raid. Registration triggers the pool build
// and a reboot, so this page (like the Pro raid/setup route) has no EnsureUserDoesntExist
// guard: after the reboot the backend creates the user from saved credentials while we keep
// polling until setup completes, then show the launch screen and auto-login.

import {useEffect, useRef} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {CreatingStorage, useCreateStorage} from '../raid/create-storage'
import {HddRaidSetupState} from './use-hdd-raid-onboarding'

export default function HddRaidSetup() {
	const navigate = useNavigate()
	const location = useLocation()

	const {credentials, config, summary} = (location.state ?? {}) as Partial<HddRaidSetupState>
	const creation = useCreateStorage(credentials)

	// Register exactly once on mount; the previous step's confirmation is the person's go-ahead
	const startedRef = useRef(false)
	useEffect(() => {
		if (!credentials || !config) {
			navigate('/onboarding/create-account', {replace: true})
			return
		}
		if (startedRef.current) return
		startedRef.current = true
		creation.start(config, summary)
	}, [])

	if (!credentials || !config) return null

	return <CreatingStorage creation={creation} isPro={false} name={credentials.name} />
}
