import {useContext} from 'react'

import {ConfirmationContext} from '@/providers/confirmation/confirmation-context'
import type {ConfirmationOptions, ConfirmationResult} from '@/providers/confirmation/types'

export const useConfirmation = () => {
	const context = useContext(ConfirmationContext)

	if (!context) {
		throw new Error('useConfirmation must be used within a ConfirmationProvider')
	}

	const confirm = (options: ConfirmationOptions): Promise<ConfirmationResult> => {
		return new Promise((resolve, reject) => {
			context.requestConfirmation(options, resolve, reject)
		})
	}

	return confirm
}
