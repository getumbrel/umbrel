import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {ImmersiveDialog, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

export default function TroubleshootDialog() {
	const title = 'Troubleshoot'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	const tabs = [
		{id: 'umbrel', label: 'Umbrel logs'},
		{id: 'dmesg', label: 'DMESG logs'},
	]
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label

	return (
		<ImmersiveDialog onClose={() => navigate('/settings', {preventScrollReset: true})}>
			<div className='flex max-h-full flex-1 flex-col items-start gap-4'>
				<h1 className={cn(immersiveDialogTitleClass, '-mt-1 text-19')}>{title}</h1>
				<SegmentedControl size='lg' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
				<div className='flex-1 overflow-y-auto rounded-10 bg-black px-5 py-4 font-mono text-white/50'>
					{'Lorem ipsum dolor sit amet consectetur adipisicing elit. Ad, dolorum possimus! Delectus totam pariatur sint libero alias? Qui vitae voluptatum hic quam veniam quod cum provident autem praesentium, sint repellendus?'.repeat(
						6,
					)}
				</div>
				<div className='flex gap-2'>
					<Button variant='primary' size='dialog'>
						Download {activeLabel}
					</Button>
					<Button size='dialog'>Share with Umbrel Support </Button>
				</div>
			</div>
		</ImmersiveDialog>
	)
}
