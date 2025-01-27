import {Switch} from '@/shadcn-components/ui/switch'
import {t} from '@/utils/i18n'

interface ShareToggleProps {
	name: string
	isShared: boolean
	isLoading: boolean
	onToggle: (checked: boolean) => void
}

export function ShareToggle({name, isShared, isLoading, onToggle}: ShareToggleProps) {
	return (
		<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
			<div className='flex items-center justify-between gap-3 p-3 text-12 font-medium -tracking-3'>
				<span className='text-14'>{t('files-share.toggle', {name})}</span>
				<Switch checked={isShared} onCheckedChange={onToggle} disabled={isLoading} />
			</div>
		</div>
	)
}
