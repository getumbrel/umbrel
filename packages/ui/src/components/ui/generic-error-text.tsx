import {ChevronDown, ChevronUp} from 'lucide-react'
import {useState} from 'react'

import {t} from '@/utils/i18n'

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	return String(error)
}

export function GenericErrorText({error}: {error?: unknown}) {
	const [showDetails, setShowDetails] = useState(false)

	return (
		<div className='flex flex-col items-center'>
			<div className='font-semibold text-destructive2-lightest'>{t('something-went-wrong')}</div>
			{error != null && (
				<div className='flex flex-col items-center'>
					<button
						type='button'
						onClick={() => setShowDetails((prev) => !prev)}
						className='mt-1 flex items-center gap-0.5 text-11 text-white/30 transition-opacity duration-300 hover:text-white/50'
					>
						{showDetails ? t('hide-details') : t('show-details')}
						{showDetails ? <ChevronUp className='size-3' /> : <ChevronDown className='size-3' />}
					</button>
					{showDetails && (
						<p className='mt-1 max-h-40 overflow-y-auto text-11 break-all text-white/30'>{getErrorMessage(error)}</p>
					)}
				</div>
			)}
		</div>
	)
}

export function GenericErrorDetails({error}: {error: unknown}) {
	const [showDetails, setShowDetails] = useState(false)

	return (
		<div className='flex flex-col items-center p-3'>
			<button
				type='button'
				onClick={() => setShowDetails((prev) => !prev)}
				className='flex items-center gap-0.5 text-11 text-white/30 transition-opacity duration-300 hover:text-white/50'
			>
				{showDetails ? t('hide-details') : t('show-details')}
				{showDetails ? <ChevronUp className='size-3' /> : <ChevronDown className='size-3' />}
			</button>
			{showDetails && (
				<p className='mt-1 max-h-40 overflow-y-auto text-11 break-all text-white/30'>{getErrorMessage(error)}</p>
			)}
		</div>
	)
}
