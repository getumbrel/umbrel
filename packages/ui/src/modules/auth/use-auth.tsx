export function useJwt() {
	const jwt = window.localStorage.getItem('jwt')

	return {
		jwt,
		removeJwt() {
			window.localStorage.removeItem('jwt')
		},
		setJwt(jwt: string) {
			window.localStorage.setItem('jwt', jwt)
		},
	}
}

export function useAuth() {
	const {jwt, setJwt, removeJwt} = useJwt()

	return {
		jwt,
		logout() {
			removeJwt()
			// Hard navigate to `/login` to force all parent layouts to re-render
			window.location.href = '/login'
		},
		loginWithJwt(jwt: string) {
			setJwt(jwt)
			// Hard navigate to `/` to force all parent layouts to re-render
			window.location.href = '/'
		},
	}
}
