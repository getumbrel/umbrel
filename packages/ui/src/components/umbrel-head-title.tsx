import {useUmbrelTitle} from '@/hooks/use-umbrel-title'

export function UmbrelHeadTitle({children}: {children: string}) {
	useUmbrelTitle(children)
	return null
}
