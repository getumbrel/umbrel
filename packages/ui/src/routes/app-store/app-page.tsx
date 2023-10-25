import {useParams} from 'react-router-dom'

export function AppPage() {
	const {appId} = useParams()

	return <div>APP ID: {appId}</div>
}
