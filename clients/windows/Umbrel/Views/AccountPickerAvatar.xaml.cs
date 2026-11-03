using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Umbrel.Core;

namespace Umbrel.Views;

/// <summary>One avatar in the AccountPicker strip, 72 DIP square.</summary>
public sealed partial class AccountPickerAvatar : UserControl
{
	// Avatar paths include their content hash, so entries never go stale. The picker is
	// rebuilt whenever its accounts change; without this every rebuild would flash the
	// gradient before the photo. Same entry limit as the macOS avatar cache.
	private const int CacheLimit = 64;
	private static readonly Dictionary<string, BitmapSource> Cache = [];

	private readonly Umbreld.Target? _target;
	private readonly string? _avatarPath;
	private CancellationTokenSource? _load;

	public AccountPickerAvatar(Umbreld.Account account, Umbreld.Target? target)
	{
		InitializeComponent();
		_target = target;
		_avatarPath = account.AvatarUrl;
		Gradient.Fill = AccountGradient.For(account.UserId);
		Initial.Text = InitialOf(account.Name);
		if (CacheKey is { } key && Cache.TryGetValue(key, out var cached)) Show(cached);

		Loaded += (_, _) => _ = LoadPhotoAsync();
		Unloaded += (_, _) =>
		{
			_load?.Cancel();
			_load = null;
		};
	}

	private string? CacheKey => _target is null || _avatarPath is null ? null : $"{_target.DeviceId}\0{_avatarPath}";

	private async Task LoadPhotoAsync()
	{
		if (_target is null || _avatarPath is null || CacheKey is not { } key || Photo.Source is not null || _load is not null) return;
		var load = _load = new CancellationTokenSource();
		try
		{
			var data = await Umbreld.AccountAvatarDataAsync(_target, _avatarPath, load.Token);
			if (Decode(data) is not { } image) return;
			if (Cache.Count >= CacheLimit) Cache.Clear();
			Cache[key] = image;
			if (!load.IsCancellationRequested) Show(image);
		}
		catch (Exception)
		{
			// Like macOS, any failure (offline, cancelled, no WebP codec installed) keeps the
			// gradient and initial.
		}
		finally
		{
			if (_load == load) _load = null;
		}
	}

	// Avatars are WebP, decoded by the Windows WebP image extension through WIC. Only the
	// JPEG and PNG codecs decode straight to a smaller size; others decode at the size the
	// header declares first, so a tiny file could claim a gigabyte bitmap. umbrelOS serves
	// 512 px squares, so anything over twice that per side is refused, capping a decode at
	// 4 MiB.
	private const int MaxSourcePixels = 1024;
	// The 72 DIP avatar at 500%, the largest Windows display scale. umbrelOS avatars are
	// square, so the width alone sets the size.
	private const int DecodeWidth = 360;

	private static BitmapSource? Decode(byte[] data)
	{
		int width, height;
		// With no cache, reading the size decodes no pixels.
		using (var header = new MemoryStream(data, writable: false))
		{
			var frame = BitmapDecoder.Create(header, BitmapCreateOptions.None, BitmapCacheOption.None).Frames[0];
			(width, height) = (frame.PixelWidth, frame.PixelHeight);
		}
		if (width > MaxSourcePixels || height > MaxSourcePixels) return null;

		using var stream = new MemoryStream(data, writable: false);
		var image = new BitmapImage();
		image.BeginInit();
		image.CacheOption = BitmapCacheOption.OnLoad; // decode now, so the stream can close
		// Only ever shrink: the height follows the aspect ratio, so a narrow image widened to
		// this size would grow far past the bound.
		if (width > DecodeWidth) image.DecodePixelWidth = DecodeWidth;
		image.StreamSource = stream;
		image.EndInit();
		image.Freeze();
		return image;
	}

	private void Show(BitmapSource image)
	{
		Photo.Source = image;
		Gradient.Visibility = Visibility.Collapsed;
		Initial.Visibility = Visibility.Collapsed;
	}

	// The first user-perceived character, so an emoji or accented letter stays whole.
	private static string InitialOf(string name)
	{
		var trimmed = name.Trim();
		return trimmed.Length == 0 ? "" : StringInfo.GetNextTextElement(trimmed).ToUpperInvariant();
	}

	private static class AccountGradient
	{
		// Keep this palette and hash in sync with macOS, iOS, and umbrelOS. Account colours
		// derive from the immutable id, so they stay stable without stored UI state.
		private static readonly LinearGradientBrush[] Meshes =
		[
			Mesh(90, (0xFA709A, 0), (0xFEE140, 1)),
			Mesh(0, (0xE14FAD, 0), (0xF9D423, 1)),
			Mesh(90, (0xF83600, 0), (0xF9D423, 1)),
			Mesh(-60, (0xFF5858, 0), (0xF09819, 1)),
			Mesh(0, (0xFF0844, 0), (0xFFB199, 1)),
			Mesh(120, (0xF093FB, 0), (0xF5576C, 1)),
			Mesh(-225, (0xFF3CAC, 0), (0x562B7C, 0.52), (0x2B86C5, 1)),
			Mesh(-225, (0x231557, 0), (0x44107A, 0.29), (0xFF1361, 0.67), (0xFFF800, 1)),
			Mesh(0,
				(0xFCC5E4, 0), (0xFDA34B, 0.15), (0xFF7882, 0.35), (0xC8699E, 0.52),
				(0x7046AA, 0.71), (0x0C1DB8, 0.87), (0x020F75, 1)),
			Mesh(0, (0x3B41C5, 0), (0xA981BB, 0.49), (0xFFC8A9, 1)),
			Mesh(-20, (0xB721FF, 0), (0x21D4FD, 1)),
			Mesh(-225, (0xAC32E4, 0), (0x7918F2, 0.48), (0x4801FF, 1)),
			Mesh(0, (0xF43B47, 0), (0x453A94, 1)),
			Mesh(0, (0x30CFD0, 0), (0x330867, 1)),
			Mesh(0, (0x007ADF, 0), (0x00ECBC, 1)),
			Mesh(-225, (0xD4FFEC, 0), (0x57F2CC, 0.48), (0x4596FB, 1)),
			Mesh(-225, (0x2CD8D5, 0), (0xC5C1FF, 0.56), (0xFFBAC3, 1)),
			Mesh(-20, (0xD558C8, 0), (0x24D292, 1)),
			Mesh(-60, (0x16A085, 0), (0xF4D03F, 1)),
			Mesh(0,
				(0x3F51B1, 0), (0x5A55AE, 0.13), (0x7B5FAC, 0.25), (0x8F6AAE, 0.38),
				(0xA86AA4, 0.5), (0xCC6B8E, 0.62), (0xF18271, 0.75), (0xF3A469, 0.87),
				(0xF7C978, 1)),
		];

		// Java's String.hashCode over UTF-16 code units, the hash the other clients use.
		public static Brush For(string id)
		{
			var hash = 0;
			foreach (var codeUnit in id) hash = unchecked(hash * 31 + codeUnit);
			return Meshes[(int)(Math.Abs((long)hash) % Meshes.Length)];
		}

		// A CSS-style angle (0 points up, clockwise), with the line stretched so the end
		// colours reach the box corners, as linear-gradient() does in umbrelOS.
		private static LinearGradientBrush Mesh(double angle, params (uint Rgb, double Location)[] stops)
		{
			var radians = angle * Math.PI / 180;
			var dx = Math.Sin(radians);
			var dy = -Math.Cos(radians);
			var length = Math.Abs(dx) + Math.Abs(dy);
			var brush = new LinearGradientBrush
			{
				StartPoint = new Point(0.5 - dx * length / 2, 0.5 - dy * length / 2),
				EndPoint = new Point(0.5 + dx * length / 2, 0.5 + dy * length / 2),
			};
			foreach (var (rgb, location) in stops)
			{
				var color = Color.FromRgb((byte)((rgb >> 16) & 0xFF), (byte)((rgb >> 8) & 0xFF), (byte)(rgb & 0xFF));
				brush.GradientStops.Add(new GradientStop(color, location));
			}
			brush.Freeze();
			return brush;
		}
	}
}
