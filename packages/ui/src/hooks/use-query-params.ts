import {useSearchParams} from 'react-router-dom'
import {pickBy} from 'remeda'

// TODO: test by adding and removing `?bla=1` into the URL bar and ensuring that adding and removing param `foo` doesn't modify `bla`
export function useQueryParams() {
	const [searchParams, setSearchParams] = useSearchParams()

	const add = (param: string, value: string) => {
		const newParams = Object.fromEntries(searchParams.entries())
		setSearchParams({...newParams, [param]: value})
	}

	const remove = (param: string) => {
		const newParams = Object.fromEntries(searchParams.entries())
		setSearchParams({...pickBy(newParams, (_, k) => k !== param)})
	}

	const filter = (fn: (item: [key: string, value: string]) => boolean) => {
		setSearchParams(Object.entries(Object.fromEntries(searchParams.entries())).filter(fn))
	}

	return {
		params: searchParams,
		remove,
		add,
		filter,
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
