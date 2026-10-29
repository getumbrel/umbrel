using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Umbrel.Views;

/// <summary>macOS SectionBox: a dark rounded container for hairline-divided rows. Styled in Theme.xaml.</summary>
public sealed class SectionBox : Border
{
	// Border rounds only its own background, so a hovered first or last row would
	// square off the corners. Clip like the Mac's clipShape.
	protected override void OnRenderSizeChanged(SizeChangedInfo sizeInfo)
	{
		base.OnRenderSizeChanged(sizeInfo);
		var radius = CornerRadius.TopLeft;
		Clip = new RectangleGeometry(new Rect(sizeInfo.NewSize), radius, radius);
	}
}
