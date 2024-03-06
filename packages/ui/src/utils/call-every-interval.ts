import {MS_PER_HOUR} from '@/utils/date-time'

const REFRESH_INTERVAL: number = MS_PER_HOUR

// Mostly generated with ChatGPT
export function callEveryInterval(
	localStorageKey: string,
	funcToCall: () => void,
	interval: number = REFRESH_INTERVAL,
) {
	function shouldCallFunction() {
		const lastCalledTimeStr: string | null = localStorage.getItem(localStorageKey)
		const now = new Date().getTime()

		// Parse the lastCalledTime to number. If null, lastCalledTime will be 0
		const lastCalledTime: number = lastCalledTimeStr ? parseInt(lastCalledTimeStr, 10) : 0

		// Check if more than an hour has passed since the last call
		if (!lastCalledTimeStr || now - lastCalledTime > interval) {
			// Update the last called time
			localStorage.setItem(localStorageKey, now.toString())
			// Call your function
			funcToCall()
		}
	}

	// Call this function when the page loads
	document.addEventListener('DOMContentLoaded', shouldCallFunction)

	// Optional: Call `myFunction` every hour, regardless of user interaction
	setInterval(() => {
		shouldCallFunction()
	}, interval)
}
