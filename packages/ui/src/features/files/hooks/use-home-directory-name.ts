import {useTranslation} from 'react-i18next'

import {trpcReact} from '@/trpc/trpc'
import {firstNameFromFullName} from '@/utils/misc'

export function useHomeDirectoryName() {
	const {t} = useTranslation()
	const userQuery = trpcReact.user.get.useQuery()
	const userName = userQuery.data?.name
	return userName
		? t('files-sidebar.owners-umbrel', {name: firstNameFromFullName(userName)})
		: t('files-sidebar.my-umbrel')
}
