import {useState} from 'react'

import {cn} from '@/lib/utils'
import {useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'

// A video as it looks at the moment a search matched in it (a result's
// `moment.thumbnail`), laid over the video's ordinary thumbnail: a search for
// a dog should not be answered with the kitchen the video opens on. Until the
// still arrives the tile is `backdrop` rather than that kitchen. A still that
// cannot be had steps aside, and the ordinary thumbnail beneath is the tile
// after all.
export function MomentStill({url, backdrop}: {url: string; backdrop?: string}) {
	const src = useSharedAuthorizedHttpUrl(url)
	// Of this url alone: a tile can be handed another moment of the same video
	const [settled, setSettled] = useState<{url: string; loaded: boolean}>()
	const loaded = settled?.url === url ? settled.loaded : undefined
	if (loaded === false) return null
	return (
		<span className='absolute inset-0' style={{backgroundColor: backdrop}}>
			{src && (
				<img
					key={url}
					src={src}
					alt=''
					aria-hidden='true'
					draggable={false}
					decoding='async'
					onLoad={() => setSettled({url, loaded: true})}
					onError={() => setSettled({url, loaded: false})}
					className={cn(
						'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
						loaded ? 'opacity-100' : 'opacity-0',
					)}
				/>
			)}
		</span>
	)
}
