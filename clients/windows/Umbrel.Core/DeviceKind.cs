namespace Umbrel.Core;

/// <summary>
/// The hardware family represented by umbreld's human-readable device model. The
/// same classifier as the Apple apps so a discovered or offline device never renders
/// as a different Umbrel model by accident.
/// </summary>
public enum UmbrelDeviceKind
{
	Home,
	Pro,
	AsusNuc14Essential,
	AsusNuc16Pro,
	AsusRogNuc16,
	RaspberryPi,
	Generic,
}

public static class UmbrelDeviceKindExtensions
{
	public static UmbrelDeviceKind FromModel(string? model)
	{
		var value = model?.ToLowerInvariant() ?? "";
		if (value.Contains("umbrel home")) return UmbrelDeviceKind.Home;
		if (value.Contains("umbrel pro")) return UmbrelDeviceKind.Pro;
		if (value.Contains("asus nuc 14 essential")) return UmbrelDeviceKind.AsusNuc14Essential;
		if (value.Contains("asus nuc 16 pro")) return UmbrelDeviceKind.AsusNuc16Pro;
		if (value.Contains("asus rog nuc 16")) return UmbrelDeviceKind.AsusRogNuc16;
		if (value.Contains("raspberry pi")) return UmbrelDeviceKind.RaspberryPi;
		return UmbrelDeviceKind.Generic;
	}
}
