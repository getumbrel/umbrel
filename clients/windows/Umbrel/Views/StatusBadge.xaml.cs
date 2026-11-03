using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace Umbrel.Views;

public sealed partial class StatusBadge : UserControl
{
	// A file path, like the other asset bindings. Strings compare by value, so the view
	// model re-raising the same path does not replay the entrance.
	public static readonly DependencyProperty IconProperty = DependencyProperty.Register(
		nameof(Icon), typeof(string), typeof(StatusBadge),
		new PropertyMetadata(null, (sender, _) => ((StatusBadge)sender).OnIconChanged()));

	public static readonly DependencyProperty RingColorProperty = DependencyProperty.Register(
		nameof(RingColor), typeof(Brush), typeof(StatusBadge));

	private const double CenterRadius = 19;
	private const double RingWidth = 14;
	private const int RingCount = 4;
	private const double InnerOpacity = 0.15;
	private const double OuterOpacity = 0.05;

	// macOS uses spring(duration: 0.35, bounce: 0.35): damping ratio 0.65, a single 6.8%
	// overshoot at 0.23 s and no visible second swing. BackEase overshoots once (amplitude
	// 0.35 peaks 6.9% past the target at 0.21 s); ElasticEase would keep oscillating.
	private static readonly TimeSpan EntranceDuration = TimeSpan.FromSeconds(0.35);
	private static readonly BackEase Spring = Frozen(new BackEase { Amplitude = 0.35, EasingMode = EasingMode.EaseOut });

	// macOS easeInOut(duration: 1.5), autoreversing: one pulse every 3 s.
	private static readonly TimeSpan PulseDuration = TimeSpan.FromSeconds(1.5);
	private static readonly KeySpline EaseInOut = Frozen(new KeySpline(0.42, 0, 0.58, 1));

	private readonly List<Ring> _rings = [];
	private bool _entered;

	public StatusBadge()
	{
		InitializeComponent();
		// Outermost first so each smaller ring draws over the larger ones.
		for (var index = 0; index < RingCount; index++)
		{
			var size = CenterRadius * 2 + RingWidth * 2 * (RingCount - index);
			var opacity = OuterOpacity + (InnerOpacity - OuterOpacity) * index / (RingCount - 1);
			var entrance = new ScaleTransform();
			var pulse = new ScaleTransform();
			var view = new Ellipse
			{
				Width = size,
				Height = size,
				Opacity = opacity,
				RenderTransformOrigin = new Point(0.5, 0.5),
				// Separate transforms so the staggered entrance and pulse never fight over one value.
				RenderTransform = new TransformGroup { Children = { entrance, pulse } },
			};
			view.SetBinding(Shape.FillProperty, new Binding(nameof(RingColor)) { Source = this });
			Badge.Children.Insert(index, view);
			// Rings ripple in from the center, innermost first, and pulse outward in the same order.
			var step = RingCount - 1 - index;
			_rings.Add(new Ring(view, entrance, pulse, opacity, TimeSpan.FromSeconds(step * 0.06), TimeSpan.FromSeconds(step * 0.15)));
		}
		IsVisibleChanged += (_, _) => Animate();
	}

	public string? Icon
	{
		get => (string?)GetValue(IconProperty);
		set => SetValue(IconProperty, value);
	}

	public Brush? RingColor
	{
		get => (Brush?)GetValue(RingColorProperty);
		set => SetValue(RingColorProperty, value);
	}

	private sealed record Ring(Ellipse View, ScaleTransform Entrance, ScaleTransform Pulse, double BaseOpacity, TimeSpan EntranceDelay, TimeSpan PulseDelay);

	// macOS gives each state its own badge view, so a new icon plays the entrance again.
	private void OnIconChanged()
	{
		Badge.Visibility = Icon is null ? Visibility.Collapsed : Visibility.Visible;
		_entered = false;
		Animate();
	}

	// The entrance plays once per icon; the pulse runs only while the badge is on screen,
	// because a forever animation keeps ticking until it is removed. With Animation effects
	// off the badge stays at rest, which is also every property's base value.
	private void Animate()
	{
		Stop();
		if (Icon is null || !IsVisible || !SystemParameters.ClientAreaAnimation) return;
		if (!_entered)
		{
			_entered = true;
			Scale(IconScale, Entrance(0.6, TimeSpan.Zero));
			// The overshoot past full opacity renders as 1, as it does on macOS.
			IconImage.BeginAnimation(OpacityProperty, Entrance(0, TimeSpan.Zero));
			foreach (var ring in _rings) Scale(ring.Entrance, Entrance(0.6, ring.EntranceDelay));
		}
		foreach (var ring in _rings)
		{
			Scale(ring.Pulse, Pulse(1.04, ring.PulseDelay));
			ring.View.BeginAnimation(OpacityProperty, Pulse(ring.BaseOpacity * 1.4, ring.PulseDelay));
		}
	}

	private void Stop()
	{
		Scale(IconScale, null);
		IconImage.BeginAnimation(OpacityProperty, null);
		foreach (var ring in _rings)
		{
			Scale(ring.Entrance, null);
			Scale(ring.Pulse, null);
			ring.View.BeginAnimation(OpacityProperty, null);
		}
	}

	// The key frame at time zero holds the start value through the stagger delay. The end
	// value is the base value, so the animation can stop affecting the property once done.
	private static DoubleAnimationUsingKeyFrames Entrance(double from, TimeSpan delay) => new()
	{
		FillBehavior = FillBehavior.Stop,
		KeyFrames =
		{
			new DiscreteDoubleKeyFrame(from, KeyTime.FromTimeSpan(TimeSpan.Zero)),
			new DiscreteDoubleKeyFrame(from, KeyTime.FromTimeSpan(delay)),
			new EasingDoubleKeyFrame(1, KeyTime.FromTimeSpan(delay + EntranceDuration), Spring),
		},
	};

	// Starts from the base value. BeginTime delays only the first cycle, so the rings keep their stagger.
	private static DoubleAnimationUsingKeyFrames Pulse(double to, TimeSpan delay) => new()
	{
		BeginTime = delay,
		AutoReverse = true,
		RepeatBehavior = RepeatBehavior.Forever,
		KeyFrames = { new SplineDoubleKeyFrame(to, KeyTime.FromTimeSpan(PulseDuration), EaseInOut) },
	};

	// One clock drives both axes so the scale stays uniform; null removes the animation.
	private static void Scale(ScaleTransform transform, AnimationTimeline? animation)
	{
		var clock = animation?.CreateClock();
		transform.ApplyAnimationClock(ScaleTransform.ScaleXProperty, clock);
		transform.ApplyAnimationClock(ScaleTransform.ScaleYProperty, clock);
	}

	private static T Frozen<T>(T freezable) where T : Freezable
	{
		freezable.Freeze();
		return freezable;
	}
}
