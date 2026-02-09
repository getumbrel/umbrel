import {TbAlertTriangleFilled} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

type RaidErrorProps = {
	title: string
	instructions: string
	image?: {
		src: string
		alt: string
	}
}

// Error component for both device detection errors and no SSDs found.
export function RaidError({title, instructions, image}: RaidErrorProps) {
	const shutdownMut = trpcReact.system.shutdown.useMutation({
		onError: (error) => {
			toast.error(`Failed to shut down: ${error.message}`)
		},
	})

	const handleShutdown = () => {
		shutdownMut.mutate()
	}

	return (
		<div className={`flex flex-1 flex-col items-center justify-center ${image ? 'md:justify-between' : ''}`}>
			{/* Content */}
			<div className={`flex flex-col items-center gap-4 px-4 ${image ? 'md:pt-8' : ''}`}>
				<TbAlertTriangleFilled className='size-[22px] text-[#F5A623]' />
				<h1
					className='-mt-1 text-[18px] font-bold text-white/85 md:text-[20px]'
					style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
				>
					{title}
				</h1>
				<p className='-mt-2 max-w-[300px] text-center text-[14px] text-white/70 md:text-[15px]'>{instructions}</p>
				<Button
					variant='destructive'
					size='lg'
					onClick={handleShutdown}
					disabled={shutdownMut.isPending}
					style={{boxShadow: '0px 2px 4px 0px #FFFFFF3D inset'}}
				>
					{shutdownMut.isPending ? t('shut-down.shutting-down') : t('shut-down')}
				</Button>
			</div>

			{/* Bottom image (optional, hidden on mobile) */}
			{image && (
				<img
					src={image.src}
					alt={image.alt}
					draggable={false}
					className='hidden w-full max-w-[800px] translate-x-14 object-contain object-bottom md:-mb-6 md:block md:translate-x-20'
					style={{
						aspectRatio: '1693 / 738',
						maskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
						WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
					}}
				/>
			)}
		</div>
	)
}
