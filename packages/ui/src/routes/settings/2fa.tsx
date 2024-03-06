import {useState} from 'react'

import {use2fa} from '@/hooks/use-2fa'
import TwoFactorDisableDialog from '@/routes/settings/2fa-disable'
import TwoFactorEnableDialog from '@/routes/settings/2fa-enable'

export function TwoFactorDialog() {
	const {isEnabled} = use2fa()

	// Need to do this because when the child component `isEnabled` changes, the other dialog will appear for a split second before the dialog closes
	const [mountEnabled] = useState(isEnabled)

	if (mountEnabled) {
		return <TwoFactorDisableDialog />
	} else {
		return <TwoFactorEnableDialog />
	}
}
