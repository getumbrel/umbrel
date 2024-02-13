import {useState} from 'react'

import {ImmersiveDialog, ImmersiveDialogFooter, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function TroubleshootDialog() {
	const title = t('troubleshoot')
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('troubleshoot')

	const tabs = [
		{id: 'umbrel', label: t('troubleshoot.umbrel-logs')},
		{id: 'dmesg', label: t('troubleshoot.dmesg-logs')},
	]
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label

	return (
		<ImmersiveDialog {...dialogProps}>
			<div className='flex max-h-full flex-1 flex-col items-start gap-4'>
				<h1 className={cn(immersiveDialogTitleClass, '-mt-1 text-19')}>{title}</h1>
				<SegmentedControl size='lg' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
				<div className='flex-1 overflow-y-auto rounded-10 bg-black px-5 py-4 font-mono text-white/50'>
					{'Lorem ipsum dolor sit amet consectetur adipisicing elit. Ad, dolorum possimus! Delectus totam pariatur sint libero alias? Qui vitae voluptatum hic quam veniam quod cum provident autem praesentium, sint repellendus?'.repeat(
						6,
					)}
				</div>
				<ImmersiveDialogFooter>
					<Button variant='primary' size='dialog'>
						{t('troubleshoot.download', {label: activeLabel})}
					</Button>
					<Button size='dialog'>{t('troubleshoot.share-with-umbrel-support')}</Button>
				</ImmersiveDialogFooter>
			</div>
		</ImmersiveDialog>
	)
}
