using System.Text.Json;
using System.Text.Json.Serialization;

namespace Umbrel.Core;

/// <summary>
/// Saved devices persist as JSON under the user's local application data folder.
/// Native grants live in <see cref="SecretStore"/>, never in this file.
/// </summary>
public sealed class Config
{
	public enum StorageIssue
	{
		Unreadable,
		CorruptQuarantined,
		CorruptNotQuarantined,
		SaveFailed,
	}

	public sealed class StorageException(Config.StorageIssue issue) : Exception(Config.Description(issue))
	{
		public Config.StorageIssue Issue { get; } = issue;
	}

	public sealed record LoadResult(Config Config, StorageIssue? Issue);

	public static string Title(StorageIssue issue) => issue switch
	{
		StorageIssue.Unreadable or StorageIssue.CorruptQuarantined or StorageIssue.CorruptNotQuarantined =>
			"Saved Umbrels Couldn’t Be Loaded",
		StorageIssue.SaveFailed => "Umbrel Settings Couldn’t Be Saved",
		_ => "Umbrel Storage Is Unavailable",
	};

	public static string Description(StorageIssue issue) => issue switch
	{
		StorageIssue.Unreadable =>
			"Umbrel couldn’t read its saved-device settings and won’t overwrite them. Check that this PC has available storage, then reopen the app.",
		StorageIssue.CorruptQuarantined =>
			"The damaged settings file was moved aside instead of being replaced. You can reconnect your Umbrels safely.",
		StorageIssue.CorruptNotQuarantined =>
			"Umbrel found a damaged settings file but couldn’t move it aside, so it won’t overwrite it. Check that this PC has available storage, then reopen the app.",
		StorageIssue.SaveFailed =>
			"Your change wasn’t saved. Check that this PC has available storage, then try again.",
		_ => "Umbrel couldn’t access its app storage. Exit and reopen Umbrel, then try again.",
	};

	private sealed class FileShape
	{
		public Dictionary<string, SavedDevice> SavedDevices { get; set; } = new();
	}

	public static readonly JsonSerializerOptions JsonOptions = new()
	{
		// A null where a value is required (such as "savedDevices": null) makes the file
		// damaged, so it is moved aside as on macOS instead of loading as an empty list.
		RespectNullableAnnotations = true,
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		PropertyNameCaseInsensitive = true,
		DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
		WriteIndented = true,
	};

	private readonly object _gate = new();
	private readonly string _filePath;
	private readonly bool _allowsWrites;
	private Dictionary<string, SavedDevice> _savedDevices;

	private Config(Dictionary<string, SavedDevice> savedDevices, string filePath, bool allowsWrites = true)
	{
		_savedDevices = savedDevices;
		_filePath = filePath;
		_allowsWrites = allowsWrites;
	}

	/// <summary>Snapshot of saved devices keyed by discovery id.</summary>
	public IReadOnlyDictionary<string, SavedDevice> SavedDevices
	{
		get
		{
			lock (_gate) return new Dictionary<string, SavedDevice>(_savedDevices);
		}
	}

	public static string DefaultDirectory =>
		Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Umbrel");

	public static string DefaultFilePath => Path.Combine(DefaultDirectory, "config.json");

	public static LoadResult Load() => Load(DefaultFilePath);

	public static LoadResult Load(string filePath)
	{
		if (!File.Exists(filePath)) return new LoadResult(new Config(new(), filePath), null);

		byte[] data;
		try
		{
			data = File.ReadAllBytes(filePath);
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
		{
			return new LoadResult(new Config(new(), filePath, allowsWrites: false), StorageIssue.Unreadable);
		}

		try
		{
			var file = JsonSerializer.Deserialize<FileShape>(data, JsonOptions) ?? throw new JsonException("empty");
			if (HasNullElements(file)) throw new JsonException("null element");
			return new LoadResult(new Config(file.SavedDevices, filePath), null);
		}
		catch (JsonException)
		{
			var quarantinePath = Path.ChangeExtension(filePath, $"corrupt-{Guid.NewGuid()}.json");
			try
			{
				File.Move(filePath, quarantinePath);
				return new LoadResult(new Config(new(), filePath), StorageIssue.CorruptQuarantined);
			}
			catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
			{
				return new LoadResult(new Config(new(), filePath, allowsWrites: false), StorageIssue.CorruptNotQuarantined);
			}
		}
	}

	// RespectNullableAnnotations doesn't check collection elements, and Swift's decoder
	// rejects a null device, address or account profile, so the file is damaged.
	private static bool HasNullElements(FileShape file) =>
		file.SavedDevices.Values.Any(device => device is null
			|| device.Addresses.Any(address => address is null)
			|| (device.AccountProfiles?.Values.Any(profile => profile is null) ?? false));

	public void Save(SavedDevice device)
	{
		lock (_gate)
		{
			var updated = new Dictionary<string, SavedDevice>(_savedDevices) { [device.Id] = device };
			Flush(updated);
			_savedDevices = updated;
		}
	}

	public void Remove(string id)
	{
		lock (_gate)
		{
			if (!_savedDevices.ContainsKey(id)) return;
			var updated = new Dictionary<string, SavedDevice>(_savedDevices);
			updated.Remove(id);
			Flush(updated);
			_savedDevices = updated;
		}
	}

	/// <summary>Apply a mutation to a saved device, skipping the disk write when nothing changed.</summary>
	public void Update(string id, Func<SavedDevice, SavedDevice> mutate)
	{
		lock (_gate)
		{
			if (!_savedDevices.TryGetValue(id, out var device)) return;
			var mutated = mutate(device);
			if (mutated == device) return;
			var updated = new Dictionary<string, SavedDevice>(_savedDevices) { [id] = mutated };
			Flush(updated);
			_savedDevices = updated;
		}
	}

	private void Flush(Dictionary<string, SavedDevice> savedDevices)
	{
		if (!_allowsWrites) throw new StorageException(StorageIssue.SaveFailed);
		try
		{
			var directory = Path.GetDirectoryName(_filePath)!;
			Directory.CreateDirectory(directory);
			var sorted = new SortedDictionary<string, SavedDevice>(savedDevices, StringComparer.Ordinal);
			var json = JsonSerializer.SerializeToUtf8Bytes(
				new FileShape { SavedDevices = new Dictionary<string, SavedDevice>(sorted) },
				JsonOptions);
			// Write to a sibling temp file and move it into place so a crash mid-write
			// can't leave a truncated config behind.
			var tempPath = Path.Combine(directory, $".config-{Guid.NewGuid():N}.tmp");
			File.WriteAllBytes(tempPath, json);
			File.Move(tempPath, _filePath, overwrite: true);
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
		{
			throw new StorageException(StorageIssue.SaveFailed);
		}
	}
}
