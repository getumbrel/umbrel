import React from 'react'
import type {IconType} from 'react-icons'

export type ConfirmationAction = {
	label: string // The label of the action
	value: string | number // The value to resolve the promise with
	// Restrict variants to common dialog action types
	variant?: 'primary' | 'destructive' | 'default'
}

export type ConfirmationOptions = {
	title: string // Title of the dialog
	message: React.ReactNode // Message of the dialog
	actions: ConfirmationAction[] // Actions of the dialog
	icon?: IconType // IconType to enforce compatibility
	showApplyToAll?: boolean // Whether to show the apply to all checkbox
}

export type ConfirmationResult = {
	actionValue: string | number // The value from the chosen ConfirmationAction
	applyToAll: boolean
}

// Type for the promise's resolve function stored in context/provider
export type ResolveFunction = (value: ConfirmationResult | PromiseLike<ConfirmationResult>) => void
// Type for the promise's reject function stored in context/provider
export type RejectFunction = (reason?: any) => void

// Shape of the context value
export type ConfirmationContextType = {
	isOpen: boolean
	options: ConfirmationOptions | null
	requestConfirmation: (options: ConfirmationOptions, resolve: ResolveFunction, reject: RejectFunction) => void
}
