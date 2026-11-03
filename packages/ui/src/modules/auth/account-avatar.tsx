import {useState} from 'react'

import {cn} from '@/lib/utils'
import {firstCharacter} from '@/utils/characters'

// Every account always has this deterministic gradient fallback. An uploaded
// image, when available, is layered on top without changing the layout.
const MESHES = [
	// True Sunset
	'linear-gradient(to right, #fa709a 0%, #fee140 100%)',
	// Juicy Cake
	'linear-gradient(to top, #e14fad 0%, #f9d423 100%)',
	// Phoenix Start
	'linear-gradient(to right, #f83600 0%, #f9d423 100%)',
	// Happy Memories
	'linear-gradient(-60deg, #ff5858 0%, #f09819 100%)',
	// Love Kiss
	'linear-gradient(to top, #ff0844 0%, #ffb199 100%)',
	// Ripe Malinka
	'linear-gradient(120deg, #f093fb 0%, #f5576c 100%)',
	// Magic Ray
	'linear-gradient(-225deg, #ff3cac 0%, #562b7c 52%, #2b86c5 100%)',
	// Fabled Sunset
	'linear-gradient(-225deg, #231557 0%, #44107a 29%, #ff1361 67%, #fff800 100%)',
	// Wide Matrix
	'linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)',
	// Solid Vault
	'linear-gradient(to top, #3b41c5 0%, #a981bb 49%, #ffc8a9 100%)',
	// October Silence
	'linear-gradient(-20deg, #b721ff 0%, #21d4fd 100%)',
	// Night Call
	'linear-gradient(-225deg, #ac32e4 0%, #7918f2 48%, #4801ff 100%)',
	// Red Salvation
	'linear-gradient(to top, #f43b47 0%, #453a94 100%)',
	// Morpheus Den
	'linear-gradient(to top, #30cfd0 0%, #330867 100%)',
	// Aqua Guidance
	'linear-gradient(to top, #007adf 0%, #00ecbc 100%)',
	// Supreme Sky
	'linear-gradient(-225deg, #d4ffec 0%, #57f2cc 48%, #4596fb 100%)',
	// Sea Lord
	'linear-gradient(-225deg, #2cd8d5 0%, #c5c1ff 56%, #ffbac3 100%)',
	// Alchemist Lab
	'linear-gradient(-20deg, #d558c8 0%, #24d292 100%)',
	// Palo Alto
	'linear-gradient(-60deg, #16a085 0%, #f4d03f 100%)',
	// Sweet Period
	'linear-gradient(to top, #3f51b1 0%, #5a55ae 13%, #7b5fac 25%, #8f6aae 38%, #a86aa4 50%, #cc6b8e 62%, #f18271 75%, #f3a469 87%, #f7c978 100%)',
]

function hashString(value: string) {
	let hash = 0
	for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
	return Math.abs(hash)
}

export function AccountAvatar({
	name,
	userId,
	avatarUrl,
	size = 96,
	className,
}: {
	name: string
	userId: string
	avatarUrl?: string
	size?: number
	className?: string
}) {
	const background = MESHES[hashString(userId) % MESHES.length]
	const initial = firstCharacter(name.trim()).toUpperCase()

	return (
		<div
			aria-hidden
			className={cn(
				'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white select-none',
				className,
			)}
			style={{
				width: size,
				height: size,
				fontSize: size * 0.48,
				// Instrument Serif for latin initials; non-latin glyphs fall through
				// to the regular UI stack per-character
				fontFamily: "'Instrument Serif', 'Inter', system-ui, sans-serif",
				background,
				boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.3), 0 10px 30px rgba(0, 0, 0, 0.25)',
				textShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
			}}
		>
			{initial}
			{avatarUrl && <UploadedAvatar key={avatarUrl} avatarUrl={avatarUrl} />}
		</div>
	)
}

function UploadedAvatar({avatarUrl}: {avatarUrl: string}) {
	const [failed, setFailed] = useState(false)
	if (failed) return null

	return (
		<img
			alt=''
			src={avatarUrl}
			decoding='async'
			draggable={false}
			onError={() => setFailed(true)}
			className='pointer-events-none absolute inset-0 size-full rounded-full object-cover'
		/>
	)
}
