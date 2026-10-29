using System.Globalization;
using System.Windows;
using System.Windows.Data;
using Umbrel.ViewModels;

namespace Umbrel.Views;

public sealed class BoolToVisibilityConverter : IValueConverter
{
	public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
		value is true ? Visibility.Visible : Visibility.Collapsed;

	public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

public sealed class InverseBoolToVisibilityConverter : IValueConverter
{
	public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
		value is true ? Visibility.Collapsed : Visibility.Visible;

	public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

public sealed class NullToVisibilityConverter : IValueConverter
{
	public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
		value is null || value is string { Length: 0 } ? Visibility.Collapsed : Visibility.Visible;

	public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>Visible when the bound DetailMode equals any of the pipe-separated parameter names.</summary>
public sealed class ModeToVisibilityConverter : IValueConverter
{
	public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
	{
		if (value is not DetailMode mode || parameter is not string names) return Visibility.Collapsed;
		return names.Split('|').Any(name => name == mode.ToString()) ? Visibility.Visible : Visibility.Collapsed;
	}

	public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
