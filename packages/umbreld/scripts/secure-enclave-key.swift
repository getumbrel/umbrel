// A release signer's key in their Mac's Secure Enclave, which ./scripts/release-signing builds and runs.
//
//   secure-enclave-key create <key file>      Create a key and print its public key
//   secure-enclave-key public-key <key file>  Print the key's public key
//   secure-enclave-key sign <key file> <reason>
//                                             Sign each message in the JSON array of strings on standard
//                                             input, with one Touch ID for all of them, which gives the
//                                             reason in its dialog, and print a JSON array of signatures
//
// The Secure Enclave creates the key and never lets it out: the key file holds the key wrapped, encrypted
// by the Secure Enclave, which only decrypts it inside itself to sign, so no other Mac can use it. Signing
// needs Touch ID with one of the fingers enrolled when the key was made, and adding or removing a finger
// makes the key unusable, so a new one has to be provisioned. Public keys are compressed P-256 points in hex and signatures are ECDSA with SHA-256, as the
// 64 bytes of r and s in base64, which umbreld verifies.

import CryptoKit
import Foundation
import LocalAuthentication

// Signed before every message, so nothing else this key signs can count as a release signature. It's
// SIGNER_MESSAGE_PREFIX in source/modules/update/release-signing.ts.
let messagePrefix = "umbrelOS release signature\n"

func fail(_ message: String) -> Never {
	FileHandle.standardError.write(Data("\(message)\n".utf8))
	exit(1)
}

func hex(_ data: Data) -> String {
	data.map { String(format: "%02x", $0) }.joined()
}

func load(_ keyFile: String, reason: String) -> SecureEnclave.P256.Signing.PrivateKey {
	guard let data = FileManager.default.contents(atPath: keyFile) else { fail("There's no signing key at \(keyFile)") }
	let context = LAContext()
	context.localizedReason = reason
	do {
		return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data, authenticationContext: context)
	} catch {
		fail("The Secure Enclave couldn't load the signing key at \(keyFile): \(error.localizedDescription)")
	}
}

let arguments = CommandLine.arguments
guard arguments.count == (arguments.count > 1 && arguments[1] == "sign" ? 4 : 3) else {
	fail("Usage: secure-enclave-key create|public-key <key file>, or sign <key file> <reason>")
}
let (command, keyFile) = (arguments[1], arguments[2])

switch command {
case "create":
	guard SecureEnclave.isAvailable else { fail("This Mac doesn't have a Secure Enclave") }
	var biometryError: NSError?
	guard LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometryError) else {
		fail("Signing keys need Touch ID: \(biometryError?.localizedDescription ?? "it isn't available")")
	}
	guard !FileManager.default.fileExists(atPath: keyFile) else { fail("There's already a signing key at \(keyFile)") }

	var error: Unmanaged<CFError>?
	guard
		let accessControl = SecAccessControlCreateWithFlags(
			nil,
			kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
			[.privateKeyUsage, .biometryCurrentSet],
			&error
		)
	else { fail("Couldn't create the key's access control: \(error!.takeRetainedValue())") }
	let key: SecureEnclave.P256.Signing.PrivateKey
	do {
		key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: accessControl)
	} catch {
		fail("The Secure Enclave couldn't create a key: \(error.localizedDescription)")
	}

	// Only readable by the signer, and never written over another key, which would be lost
	umask(0o077)
	do {
		try FileManager.default.createDirectory(
			atPath: (keyFile as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
		try key.dataRepresentation.write(to: URL(fileURLWithPath: keyFile), options: .withoutOverwriting)
	} catch {
		fail("Couldn't save the signing key to \(keyFile): \(error.localizedDescription)")
	}
	print(hex(key.publicKey.compressedRepresentation))

case "public-key":
	print(hex(load(keyFile, reason: "read your umbrelOS signing key").publicKey.compressedRepresentation))

case "sign":
	guard
		let messages = try? JSONDecoder().decode([String].self, from: FileHandle.standardInput.readDataToEndOfFile())
	else { fail("Give the messages to sign as a JSON array of strings") }
	guard FileManager.default.fileExists(atPath: keyFile) else { fail("There's no signing key at \(keyFile)") }

	// One Touch ID for every message, by authenticating a context first and signing them all with it.
	// macOS shows the reason after "<helper> is trying to".
	let context = LAContext()
	// The key only signs with Touch ID, so the dialog doesn't offer a password, which would only fail
	context.localizedFallbackTitle = ""
	let authenticated = DispatchSemaphore(value: 0)
	var authenticationError: Error?
	context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: arguments[3]) { success, error in
		if !success { authenticationError = error ?? LAError(.authenticationFailed) }
		authenticated.signal()
	}
	authenticated.wait()
	if let error = authenticationError {
		switch (error as? LAError)?.code {
		case .userCancel: fail("Touch ID was cancelled")
		case .userFallback: fail("Signing needs Touch ID, not a password")
		default: fail("Touch ID didn't authenticate: \(error.localizedDescription)")
		}
	}

	let key: SecureEnclave.P256.Signing.PrivateKey
	do {
		key = try SecureEnclave.P256.Signing.PrivateKey(
			dataRepresentation: FileManager.default.contents(atPath: keyFile)!, authenticationContext: context)
	} catch {
		fail("The Secure Enclave couldn't load the signing key at \(keyFile): \(error.localizedDescription)")
	}
	var signatures: [String] = []
	for message in messages {
		do {
			let signature = try key.signature(for: Data(messagePrefix.utf8) + Data(message.utf8))
			signatures.append(signature.rawRepresentation.base64EncodedString())
		} catch {
			fail("The Secure Enclave didn't sign: \(error.localizedDescription)")
		}
	}
	print(String(data: try! JSONEncoder().encode(signatures), encoding: .utf8)!)

default:
	fail("Unknown command \(command)")
}
