namespace Umbrel.ViewModels;

/// <summary>
/// What the app says when a saved Umbrel answers with a new identity. That's expected after
/// its certificate is reset or it's restored from a backup (backups leave out the
/// certificates), and anyone with access to the Umbrel may have done it. It's also what
/// someone pretending to be the Umbrel looks like, so the words ask people to check before
/// they reconnect. A factory reset or new storage gives a new id, so the device page never
/// shows this for them, but the shorter error for a refused certificate (LocalHttps) still can.
/// </summary>
public static class IdentityChange
{
	public const string Status = "Can’t verify";
	public const string Title = "Can’t confirm this is your Umbrel";
	public const string Message =
		"Its security identity changed. That’s expected if it was restored from a backup or its certificate was reset " +
		"since this PC last connected. If neither happened, don’t reconnect. Someone on this network could be " +
		"pretending to be your Umbrel.";
	public const string ConfirmTitle = "Was your Umbrel restored or its certificate reset?";
	public const string ConfirmMessage =
		"Only reconnect if one of these happened, and do it at home, on your own network. Not sure? Ask whoever " +
		"manages your Umbrel.\n\nYou’ll sign in again.";
}
