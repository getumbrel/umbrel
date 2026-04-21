import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertCircle} from 'react-icons/tb'
import {Navigate} from 'react-router-dom'

import {BareCoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact} from '@/trpc/trpc'

// This page is loaded in a new tab by the static IP flow. Its mere ability to load at
// `http://{newIp}/confirm-static-ip` is proof that the new IP is reachable. On mount it
// calls `system.confirmStaticIp` with `window.location.hostname`, unblocking the
// long-running `setStaticIp` mutation on the original tab. On success we navigate to
// the login page, passing the confirmed IP via router state so login can show a dialog.
export default function ConfirmStaticIp() {
	const {t} = useTranslation()
	const [status, setStatus] = useState<'confirming' | 'success' | 'error'>('confirming')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const hasFiredRef = useRef(false)

	const ip = window.location.hostname
	// This page only makes sense when loaded at an IP (e.g. http://192.168.1.100/confirm-static-ip).
	// The regex is a loose "looks like IPv4" check, not strict validation — the backend's zod
	// schema handles that. This just prevents showing an error page when accessed via hostname.
	const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(ip)
	if (!isIp) return <Navigate to='/login' replace />

	const confirmMut = trpcReact.system.confirmStaticIp.useMutation({
		onSuccess: () => setStatus('success'),
		onError: (err) => {
			setErrorMessage(err.message)
			setStatus('error')
		},
	})

	useEffect(() => {
		if (hasFiredRef.current) return
		hasFiredRef.current = true
		confirmMut.mutate({ip})
	}, [])

	// In practice, if this page loaded the mutation will succeed in milliseconds (same server).
	// The error state and timeout below are defense in depth for edge cases.
	useEffect(() => {
		const timer = setTimeout(() => {
			setStatus((s) => (s === 'confirming' ? 'error' : s))
		}, 15_000)
		return () => clearTimeout(timer)
	}, [])

	if (status === 'success') {
		return <Navigate to='/login' replace state={{confirmedIp: ip}} />
	}

	if (status === 'error') {
		return (
			<BareCoverMessage>
				<div className='flex flex-col items-center gap-2'>
					<TbAlertCircle className='size-12 text-destructive2-lightest' />
					<h2 className='text-15 font-semibold -tracking-2'>{t('confirm-static-ip.error-title')}</h2>
					<CoverMessageParagraph>{errorMessage ?? t('confirm-static-ip.error-description')}</CoverMessageParagraph>
				</div>
			</BareCoverMessage>
		)
	}

	return (
		<BareCoverMessage>
			<Loading>{t('confirm-static-ip.confirming')}</Loading>
			<CoverMessageParagraph>{t('confirm-static-ip.confirming-description', {ip})}</CoverMessageParagraph>
		</BareCoverMessage>
	)
}
