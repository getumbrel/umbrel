import React, {useEffect, useId, useState} from 'react'

import type {ConfirmationOptions, ConfirmationResult} from '@/providers/confirmation/types'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Checkbox, checkboxContainerClass, checkboxLabelClass} from '@/shadcn-components/ui/checkbox'
import {cn} from '@/shadcn-lib/utils'

interface GenericConfirmationDialogProps {
	isOpen: boolean
	options: ConfirmationOptions | null
	onResolve: (result: ConfirmationResult) => void
	onReject: (reason?: any) => void
}

export const GenericConfirmationDialog: React.FC<GenericConfirmationDialogProps> = ({
	isOpen,
	options,
	onResolve,
	onReject,
}) => {
	const [applyToAllChecked, setApplyToAllChecked] = useState(false)
	const checkboxId = useId()

	// Reset checkbox state when dialog options change (i.e., a new confirmation opens)
	useEffect(() => {
		if (isOpen) {
			setApplyToAllChecked(false)
		}
	}, [isOpen, options])

	if (!options) {
		// Render nothing if options are null (e.g., during fade-out animation or initial state)
		return null
	}

	const {title, message, actions, icon: IconComponent, showApplyToAll} = options

	// If the action represents a user cancellation (with the value "cancel"),
	// propagate the promise rejection so callers can distinguish cancellation from
	// other confirmed actions. Otherwise, resolve with the chosen value.
	const handleActionClick = (value: string | number) => {
		if (value === 'cancel') {
			// Treat this as an explicit cancellation
			onReject('cancel')
			return
		}
		onResolve({actionValue: value, applyToAll: showApplyToAll ? applyToAllChecked : false})
	}

	// Use onOpenChange for dismissal (clicking outside, pressing Esc)
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			// Trigger reject only if the dialog was intentionally closed by the user
			// without choosing an action.
			onReject('Dialog dismissed by user')
		}
	}

	return (
		<AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader icon={IconComponent}>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{message && <AlertDialogDescription>{message}</AlertDialogDescription>}
				</AlertDialogHeader>

				{/* Action Buttons */}
				<div className='flex flex-col justify-center gap-y-2 md:flex-row md:gap-x-2 md:gap-y-0'>
					{actions.map((action, index) => (
						<AlertDialogAction
							key={action.label}
							variant={action.variant || 'default'}
							className='px-6'
							onClick={() => handleActionClick(action.value)}
							hideEnterIcon={index !== 0}
						>
							{action.label}
						</AlertDialogAction>
					))}
				</div>

				{/* "Apply to all" checkbox (only if enabled) */}
				{showApplyToAll && (
					<AlertDialogFooter>
						<div className={cn(checkboxContainerClass)}>
							<Checkbox
								id={checkboxId}
								checked={applyToAllChecked}
								onCheckedChange={(checked) => setApplyToAllChecked(!!checked)}
								className='h-4 w-4 rounded-4'
							/>
							<label htmlFor={checkboxId} className={cn(checkboxLabelClass, 'text-12 text-white/40')}>
								Apply to all
							</label>
						</div>
					</AlertDialogFooter>
				)}
			</AlertDialogContent>
		</AlertDialog>
	)
}
