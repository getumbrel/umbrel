import {Plus} from 'lucide-react'

export function AddManuallyCard({onClick, label}: {onClick?: () => void; label: string}) {
	return (
		<div
			className='mx-auto flex h-[110px] w-[125px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/5 p-2 transition-colors hover:border-brand hover:bg-brand/15'
			onClick={onClick}
		>
			<div className='mb-2 flex size-12 items-center justify-center'>
				<div className='flex size-12 items-center justify-center rounded-full bg-white/10'>
					<div className='flex size-8 items-center justify-center rounded-full bg-white/20'>
						<Plus className='size-4' />
					</div>
				</div>
			</div>
			<span className='w-full text-center text-12 text-white/60' title={label}>
				{label}
			</span>
		</div>
	)
}

export function ServerCard({
	children,
	selected = false,
	onClick,
}: {
	children: React.ReactNode
	selected?: boolean
	onClick?: () => void
}) {
	return (
		<div
			className={`mx-auto flex h-[110px] w-[125px] cursor-pointer flex-col items-center justify-center rounded-xl p-2 transition-colors ${
				selected ? 'border border-brand bg-brand/15' : 'border border-white/10 bg-white/5 hover:bg-white/10'
			}`}
			onClick={onClick}
		>
			{children}
		</div>
	)
}
