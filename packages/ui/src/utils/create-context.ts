// TODO: migrate all existing contexts to use this helper.

import {createContext as _createContext, useContext as _useContext} from 'react'

export interface CreateContextOptions {
	strict?: boolean
	errorMessage?: string
	name?: string
}

type CreateContextReturn<T> = [React.Provider<T>, () => T, React.Context<T>]

export function createContext<ContextType>(options: CreateContextOptions = {}) {
	const {
		strict = true,
		errorMessage = 'useContext: `context` is undefined. Seems you forgot to wrap component within the Provider',
		name,
	} = options

	const Context = _createContext<ContextType | undefined>(undefined)

	Context.displayName = name

	function useContext() {
		const context = _useContext(Context)

		if (!context && strict) {
			throw new Error(errorMessage)
		}

		return context
	}

	return [Context.Provider, useContext, Context] as CreateContextReturn<ContextType>
}
