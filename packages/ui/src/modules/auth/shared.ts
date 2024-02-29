import {trpcClient} from '@/trpc/trpc'
import {callEveryInterval} from '@/utils/call-every-interval'
import {MS_PER_HOUR} from '@/utils/date-time'

export const JWT_LOCAL_STORAGE_KEY = 'jwt'
export const JWT_REFRESH_LOCAL_STORAGE_KEY = 'jwt-last-refreshed'

export function initTokenRenewal() {
	callEveryInterval(
		JWT_REFRESH_LOCAL_STORAGE_KEY,
		async () => {
			const token = await trpcClient.user.renewToken.mutate()
			localStorage.setItem(JWT_LOCAL_STORAGE_KEY, token)
		},
		MS_PER_HOUR,
	)
}
