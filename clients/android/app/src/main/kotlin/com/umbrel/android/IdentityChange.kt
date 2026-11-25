package com.umbrel.android

/**
 * What the app says when a saved Umbrel answers with a new identity. That's expected after its
 * certificate is reset or it's restored from a backup, but it's also what someone pretending to
 * be the Umbrel looks like, so the words ask people to check before they reconnect. Matches iOS
 * and Windows.
 */
internal object IdentityChange {
	const val STATUS = "Can’t verify"
	const val TITLE = "Can’t confirm this is your Umbrel"
	const val ALERT_TITLE = "Can’t Confirm This Is Your Umbrel"
	const val MESSAGE = "Its security identity changed. That’s expected if it was restored from a backup or its " +
		"certificate was reset since this phone last connected. If neither happened, don’t reconnect. Someone on " +
		"this network could be pretending to be your Umbrel."
	const val BLOCKED_MESSAGE = "Its security identity changed, so this didn’t open. Check Home before reconnecting."
	const val CONFIRM_TITLE = "Was your Umbrel restored or its certificate reset?"
	const val CONFIRM_MESSAGE = "Only reconnect if one of these happened, and do it at home, on your own Wi-Fi. Not " +
		"sure? Ask whoever manages your Umbrel.\n\nYou’ll sign in again. If photo backup is on, you’ll need to " +
		"turn it back on."
}
