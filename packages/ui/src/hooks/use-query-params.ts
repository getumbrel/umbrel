import {useLocation, useNavigate, useSearchParams} from 'react-router-dom'

export function useQueryParams() {
	const navigate = useNavigate()
	const location = useLocation()
	const [searchParams] = useSearchParams()

	const removeQueryParam = (param: string) => {
		const currentUrl = new URL(window.location.href)
		const params = new URLSearchParams(location.search)

		// Remove the query parameter you want
		params.delete(param)

		// Navigate to the new URL without the query parameter
		navigate(`${currentUrl.pathname}?${params.toString()}`, {replace: true})
	}

	return {
		params: new URLSearchParams(location.search),
		removeParam: removeQueryParam,
		/**
		 * For use in React Router `Link`:
		 * ```jsx
		 * // EXAMPLE
		 * <Link to={{ search: addLinkSearchParams({ page: 1 }) }}>Page 1</Link>
		 * ```
		 */
		addLinkSearchParams: (newParams: {[key: string]: string}) => {
			return new URLSearchParams({
				...Object.fromEntries(searchParams.entries()),
				...newParams,
			}).toString()
		},
	}
}
