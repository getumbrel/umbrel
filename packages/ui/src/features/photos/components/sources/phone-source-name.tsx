import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCheck, TbLoader, TbPencil} from 'react-icons/tb'
import {useClickAway} from 'react-use'

import {Input} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {usePhotoSourceActions, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'

export function PhoneSourceName({source}: {source: Pick<PhotoSource, 'id' | 'name'>}) {
	const {t} = useTranslation()
	const {renameSource, isRenaming} = usePhotoSourceActions()
	const [editing, setEditing] = useState(false)
	const [name, setName] = useState(source.name)
	const editorRef = useRef<HTMLFormElement>(null)
	useClickAway(editorRef, () => {
		if (!isRenaming) setEditing(false)
	})
	const trimmed = name.trim()
	// Match the server's source-name rules, including pasted control characters.
	// eslint-disable-next-line no-control-regex
	const valid = trimmed.length > 0 && trimmed.length <= 100 && !/[\u0000-\u001f\u007f]/.test(trimmed)

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!valid || trimmed === source.name || isRenaming) return
		try {
			await renameSource({id: source.id, name: trimmed})
			setEditing(false)
		} catch {
			toast.error(t('photos-source.rename-failed'), {area: 'photos'})
		}
	}

	if (!editing) {
		return (
			<button
				type='button'
				aria-label={`${t('photos-source.rename')}: ${source.name}`}
				title={source.name}
				className={cn(
					'group mx-auto flex h-9 max-w-full items-center justify-center gap-1.5 rounded px-1 text-15 font-semibold -tracking-2',
					focusRingClass,
				)}
				onClick={() => {
					setName(source.name)
					setEditing(true)
				}}
			>
				<span className='min-w-0 truncate'>{source.name}</span>
				<TbPencil
					aria-hidden='true'
					className='size-3.5 shrink-0 text-white/40 transition-colors group-hover:text-white/70'
				/>
			</button>
		)
	}

	return (
		<form ref={editorRef} onSubmit={submit} className='mx-auto flex h-9 w-full max-w-[320px] items-center gap-1'>
			<Input
				value={name}
				onValueChange={setName}
				aria-label={t('name')}
				sizeVariant='short-square'
				className='h-8 min-w-0 flex-1 text-center text-15 font-semibold -tracking-2'
				maxLength={100}
				disabled={isRenaming}
				autoFocus
				onFocus={(event) => event.target.select()}
			/>
			<button
				type='submit'
				aria-label={t('photos-source.rename-save')}
				title={t('photos-source.rename-save')}
				className={cn(
					'flex size-8 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40',
					focusRingClass,
				)}
				disabled={!valid || trimmed === source.name || isRenaming}
			>
				{isRenaming ? (
					<TbLoader aria-hidden='true' className='size-4 animate-spin' />
				) : (
					<TbCheck aria-hidden='true' className='size-4' />
				)}
			</button>
		</form>
	)
}
