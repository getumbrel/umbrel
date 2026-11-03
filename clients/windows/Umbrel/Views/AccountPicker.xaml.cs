using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Umbrel.Core;

namespace Umbrel.Views;

/// <summary>
/// macOS UmbrelAccountPicker. The owner sits in the middle with the other accounts
/// alternating right and left of it. The strip slides to centre the selected account,
/// and the lens and name follow the hovered account, falling back to the selected one.
/// </summary>
public sealed partial class AccountPicker : UserControl
{
	public static readonly DependencyProperty AccountsProperty = DependencyProperty.Register(
		nameof(Accounts), typeof(IReadOnlyList<Umbreld.Account>), typeof(AccountPicker),
		new PropertyMetadata(Array.Empty<Umbreld.Account>(), (sender, _) => ((AccountPicker)sender).Rebuild()));

	/// <summary>The Umbrel that serves the avatar photos.</summary>
	public static readonly DependencyProperty TargetProperty = DependencyProperty.Register(
		nameof(Target), typeof(Umbreld.Target), typeof(AccountPicker),
		new PropertyMetadata(null, (sender, _) => ((AccountPicker)sender).Rebuild()));

	/// <summary>Null selects the owner, as on macOS.</summary>
	public static readonly DependencyProperty SelectedUserIdProperty = DependencyProperty.Register(
		nameof(SelectedUserId), typeof(string), typeof(AccountPicker),
		new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault,
			(sender, _) => ((AccountPicker)sender).Update(animated: true)));

	/// <summary>Executed with the clicked Umbreld.Account, also when it was already selected.</summary>
	public static readonly DependencyProperty SelectCommandProperty = DependencyProperty.Register(
		nameof(SelectCommand), typeof(ICommand), typeof(AccountPicker));

	private const string OwnerId = "0";
	private const double AvatarSize = 72;
	private const double AccountStride = AvatarSize + 12; // plus the AvatarButton margin

	// macOS settles with .spring(response: 0.38, dampingFraction: 0.82). WPF has no spring
	// timing; this curve tracks that spring to within about 1.5%, starting gently and
	// leaving out only its final 1% overshoot.
	private static readonly KeySpline Settle = Frozen(new KeySpline(0.3, 0.2, 0.3, 1));
	private static readonly TimeSpan SettleDuration = TimeSpan.FromMilliseconds(300);

	private readonly Style _avatarButton;
	private IReadOnlyList<Umbreld.Account> _arranged = [];
	private string? _hoveredUserId;
	private Point? _pointer;
	private double _stripX = double.NaN;
	private double _lensX = double.NaN;

	public AccountPicker()
	{
		InitializeComponent();
		_avatarButton = (Style)Resources["AvatarButton"];
		IsEnabledChanged += (_, _) =>
		{
			if (!IsEnabled) Hover(null);
		};
	}

	public IReadOnlyList<Umbreld.Account> Accounts
	{
		get => (IReadOnlyList<Umbreld.Account>?)GetValue(AccountsProperty) ?? [];
		set => SetValue(AccountsProperty, value);
	}

	public Umbreld.Target? Target
	{
		get => (Umbreld.Target?)GetValue(TargetProperty);
		set => SetValue(TargetProperty, value);
	}

	public string? SelectedUserId
	{
		get => (string?)GetValue(SelectedUserIdProperty);
		set => SetValue(SelectedUserIdProperty, value);
	}

	public ICommand? SelectCommand
	{
		get => (ICommand?)GetValue(SelectCommandProperty);
		set => SetValue(SelectCommandProperty, value);
	}

	private int SelectedIndex
	{
		get
		{
			var id = SelectedUserId
				?? Accounts.FirstOrDefault(account => account.UserId == OwnerId)?.UserId
				?? Accounts.FirstOrDefault()?.UserId;
			return Math.Max(IndexOf(id), 0);
		}
	}

	private void Rebuild()
	{
		_arranged = Arrange(Accounts);
		_hoveredUserId = null;
		Strip.Children.Clear();
		foreach (var account in _arranged)
		{
			var button = new Button { Style = _avatarButton, Content = new AccountPickerAvatar(account, Target) };
			AutomationProperties.SetName(button, account.Name);
			button.Click += (_, _) => Choose(account);
			Strip.Children.Add(button);
		}
		Update(animated: false);
	}

	// Members alternate right, left, right... outward from the owner.
	private static IReadOnlyList<Umbreld.Account> Arrange(IReadOnlyList<Umbreld.Account> accounts)
	{
		var owner = accounts.FirstOrDefault(account => account.UserId == OwnerId);
		if (owner is null) return accounts;
		var members = accounts.Where(account => account.UserId != owner.UserId).ToList();
		var left = members.Where((_, index) => index % 2 == 1).Reverse();
		var right = members.Where((_, index) => index % 2 == 0);
		return [.. left, owner, .. right];
	}

	private int IndexOf(string? userId)
	{
		for (var index = 0; index < _arranged.Count; index++)
		{
			if (_arranged[index].UserId == userId) return index;
		}
		return -1;
	}

	private void Choose(Umbreld.Account account)
	{
		// Like macOS, clicking the selected account only reports it again.
		if (IndexOf(account.UserId) != SelectedIndex)
		{
			_hoveredUserId = null;
			SetCurrentValue(SelectedUserIdProperty, account.UserId);
		}
		if (SelectCommand is { } command && command.CanExecute(account)) command.Execute(account);
	}

	// WPF re-hit-tests a resting pointer while the strip slides under it, but macOS hover
	// only changes when the pointer moves. Ignoring those moves keeps the lens on the account
	// just clicked instead of whichever one slid under the pointer. The last position is kept
	// across leaving, since the pointer can cross a gap between avatars mid-slide.
	private void Viewport_MouseMove(object sender, MouseEventArgs e)
	{
		var pointer = e.GetPosition(Viewport);
		if (pointer == _pointer) return;
		_pointer = pointer;
		string? hovered = null;
		for (var index = 0; index < Strip.Children.Count && index < _arranged.Count; index++)
		{
			if (Strip.Children[index].IsMouseOver) hovered = _arranged[index].UserId;
		}
		if (hovered != _hoveredUserId) Hover(hovered);
	}

	private void Viewport_MouseLeave(object sender, MouseEventArgs e)
	{
		if (_hoveredUserId is not null) Hover(null);
	}

	private void Viewport_SizeChanged(object sender, SizeChangedEventArgs e) => Update(animated: false);

	private void Hover(string? userId)
	{
		_hoveredUserId = userId;
		Update(animated: true);
	}

	private void Update(bool animated)
	{
		var selected = SelectedIndex;
		var hovered = IndexOf(_hoveredUserId);
		var active = hovered >= 0 ? hovered : selected;
		NameLabel.Text = active < _arranged.Count ? FirstName(_arranged[active].Name) : "";
		for (var index = 0; index < Strip.Children.Count; index++)
		{
			AutomationProperties.SetHelpText(Strip.Children[index], index == selected ? "Selected account" : "Select this account");
		}
		Move(StripOffset, ref _stripX, (Viewport.ActualWidth - AvatarSize) / 2 - selected * AccountStride, animated);
		Move(LensOffset, ref _lensX, (active - selected) * AccountStride, animated);
	}

	private static void Move(TranslateTransform transform, ref double current, double target, bool animated)
	{
		if (target == current) return;
		current = target;
		// Windows' "Animation effects" setting stands in for macOS Reduce Motion.
		if (!animated || !SystemParameters.ClientAreaAnimation)
		{
			transform.BeginAnimation(TranslateTransform.XProperty, null);
			transform.X = target;
			return;
		}
		// No key frame at time 0, so a retarget starts from the current animated value.
		var animation = new DoubleAnimationUsingKeyFrames();
		animation.KeyFrames.Add(new SplineDoubleKeyFrame(target, KeyTime.FromTimeSpan(SettleDuration), Settle));
		transform.BeginAnimation(TranslateTransform.XProperty, animation);
	}

	private static string FirstName(string name) =>
		name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? name;

	private static KeySpline Frozen(KeySpline spline)
	{
		spline.Freeze();
		return spline;
	}
}
