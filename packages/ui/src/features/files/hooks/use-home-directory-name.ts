import {trpcReact} from '@/trpc/trpc'
import {firstNameFromFullName} from '@/utils/misc'

export function useHomeDirectoryName() {
	const userQuery = trpcReact.user.get.useQuery()
	const userName = userQuery.data?.name
	return userName ? `${firstNameFromFullName(userName)}'s Umbrel` : 'My Umbrel'
}
