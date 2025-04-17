import React, {useCallback, useRef, useState} from 'react'

import {ConfirmationContext} from '@/providers/confirmation/confirmation-context'
import {GenericConfirmationDialog} from '@/providers/confirmation/generic-confirmation-dialog'
import type {
	ConfirmationOptions,
	ConfirmationResult,
	RejectFunction,
	ResolveFunction,
} from '@/providers/confirmation/types'

interface ConfirmationProviderProps {
	children: React.ReactNode
}

export const ConfirmationProvider: React.FC<ConfirmationProviderProps> = ({children}) => {
	const [isOpen, setIsOpen] = useState(false)
	const [options, setOptions] = useState<ConfirmationOptions | null>(null)

	// Use refs to store resolve/reject functions to avoid context re-renders on every confirmation request
	const resolveRef = useRef<ResolveFunction | null>(null)
	const rejectRef = useRef<RejectFunction | null>(null)

	const requestConfirmation = useCallback(
		(opts: ConfirmationOptions, resolve: ResolveFunction, reject: RejectFunction) => {
			setOptions(opts)
			resolveRef.current = resolve
			rejectRef.current = reject
			setIsOpen(true)
		},
		[],
	)

	const handleResolve = useCallback((result: ConfirmationResult) => {
		if (resolveRef.current) {
			resolveRef.current(result)
		}
		setIsOpen(false)
	}, [])

	const handleReject = useCallback((reason?: any) => {
		if (rejectRef.current) {
			rejectRef.current(reason)
		}
		setIsOpen(false)
	}, [])

	const contextValue = {
		isOpen,
		options,
		requestConfirmation,
	}

	return (
		<ConfirmationContext.Provider value={contextValue}>
			{children}
			<GenericConfirmationDialog isOpen={isOpen} options={options} onResolve={handleResolve} onReject={handleReject} />
		</ConfirmationContext.Provider>
	)
}
