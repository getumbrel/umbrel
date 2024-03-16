import {Helmet} from 'react-helmet-async'

export function UmbrelHeadTitle({children}: {children: string}) {
	return (
		<Helmet>
			<title>Umbrel</title>
		</Helmet>
	)
}
