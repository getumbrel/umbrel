import {ChevronDown, ChevronUp} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	return String(error)
}

export function ConnectionLostScreen({error, onReconnect}: {error?: unknown; onReconnect: () => void}) {
	const {t} = useTranslation()
	const [showDetails, setShowDetails] = useState(false)

	return (
		<div className='fixed inset-0 z-50 flex items-center justify-center bg-black pt-(--safe-top)'>
			<div className='flex w-full max-w-[calc(100%-40px)] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 shadow-dialog backdrop-blur-3xl sm:max-w-md'>
				<div className='flex flex-col items-center gap-1.5'>
					<h2 className='text-15 leading-tight font-semibold -tracking-4'>{t('connection-lost')}</h2>
					<p className='text-center text-13 text-white/50'>{t('connection-lost-description')}</p>
				</div>
				<div className='flex w-full flex-col gap-2.5 md:flex-row md:justify-center'>
					{/* The wallpaper provider sets the brand color, but this screen may render outside it. */}
					<Button size='dialog' variant='default' onClick={onReconnect}>
						{t('reconnect')}
					</Button>
				</div>
				{error != null && (
					<div className='-mb-4 flex flex-col items-center'>
						<button
							type='button'
							onClick={() => setShowDetails((visible) => !visible)}
							className='flex items-center gap-0.5 text-11 text-white/30 transition-opacity duration-300 hover:text-white/50'
						>
							{showDetails ? t('hide-details') : t('show-details')}
							{showDetails ? <ChevronUp className='size-3' /> : <ChevronDown className='size-3' />}
						</button>
						{showDetails && (
							<p className='mt-1 max-h-40 w-full overflow-y-auto text-11 break-all text-white/30'>
								{getErrorMessage(error)}
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
