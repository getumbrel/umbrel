import {useSearchParams} from 'react-router-dom'
import {pickBy} from 'remeda'

type QueryObject = {[key: string]: string}

// TODO: test by adding and removing `?bla=1` into the URL bar and ensuring that adding and removing param `foo` doesn't modify `bla`
export function useQueryParams<T extends QueryObject>() {
	const [searchParams, setSearchParams] = useSearchParams()

	const add = (param: keyof T, value: string) => {
		const newParams = Object.fromEntries(searchParams.entries())
		setSearchParams({...newParams, [param]: value})
	}

	const remove = (param: keyof T) => {
		const newParams = Object.fromEntries(searchParams.entries())
		setSearchParams({...pickBy(newParams, (_, k) => k !== param)})
	}

	const filter = (fn: (item: [key: keyof T, value: string]) => boolean) => {
		setSearchParams(Object.entries(Object.fromEntries(searchParams.entries())).filter(fn))
	}

	return {
		params: searchParams,
		object: Object.fromEntries(searchParams.entries()) as T,
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
		addLinkSearchParams: (newParams: T) => {
			return new URLSearchParams({
				...Object.fromEntries(searchParams.entries()),
				...newParams,
			}).toString()
		},
	}
}
