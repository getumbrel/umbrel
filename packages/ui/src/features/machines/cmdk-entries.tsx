import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {type CmdkEntry} from '@/components/cmdk-search'
import {OsIcon} from '@/features/machines/components/os-icon'
import {machinePath} from '@/features/machines/constants'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {trpcReact} from '@/trpc/trpc'

// One command palette entry per machine, found by its name or "machines"
export function useMachinesCmdkEntries(): CmdkEntry[] {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const isOwner = userQ.data?.role === 'owner'
	const {machines} = useMachines({enabled: isOwner})

	return useMemo(() => {
		if (!isOwner) return []

		return machines.map((machine) => ({
			id: `machine:${machine.id}`,
			title: machine.name,
			keywords: [t('machines')],
			icon: <OsIcon osId={machine.osId} state={machine.state} className='h-full w-full' />,
			onSelect: () => navigate(machinePath(machine.id)),
		}))
	}, [isOwner, machines, t, navigate])
}
