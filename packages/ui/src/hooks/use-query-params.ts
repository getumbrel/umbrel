import {NavigateOptions, useSearchParams} from 'react-router-dom'
import {pickBy} from 'remeda'

type QueryObject = {[key: string]: string}

// TODO: test by adding and removing `?bla=1` into the URL bar and ensuring that adding and removing param `foo` doesn't modify `bla`
export function useQueryParams<T extends QueryObject>() {
	const [searchParams, setSearchParams] = useSearchParams()

	const object = Object.fromEntries(searchParams.entries()) as T

	const add = (param: keyof T, value: string, navigateOpts?: NavigateOptions) => {
		const newParams = {...object, [param]: value}
		setSearchParams(newParams, navigateOpts)
	}

	const remove = (param: keyof T, navigateOpts?: NavigateOptions) => {
		const newParams = {...pickBy(object, (_, k) => k !== param)}
		setSearchParams(newParams, navigateOpts)
	}

	// Adding `& string` because otherwise `key` can be a number if `T` is not specified when calling `useQueryParams`
	const filter = (fn: (item: [key: keyof T & string, value: string]) => boolean, navigateOpts?: NavigateOptions) => {
		setSearchParams(Object.entries(object).filter(fn), navigateOpts)
	}

	return {
		params: searchParams,
		object,
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
				...object,
				...newParams,
			}).toString()
		},
	}
}
