import SwiftUI
import UmbrelKit

// Onboarding step 4. A live loading state: header + an animated
// radar sweep. Discovery is already running (started on the Local Network screen); as
// soon as an Umbrel appears we move to the results, and if nothing shows up within a
// grace period, and no Umbrel that answered is still being verified, we fall through
// to the no-device screen.
struct FindingView: View {
	@Environment(OnboardingModel.self) private var model

	// Minimum dwell: one full sweep rotation. The screen always plays one complete
	// revolution before resolving, so an instant discovery doesn't flash past (or cut
	// off the entry push mid-flight). The scan is real; this only paces the exit.
	private static let minDwell: Duration = .seconds(2.4)
	// The fallback scan finishes within its time limit; past that, this only guards
	// against a browse that keeps restarting verification
	private static let maxVerificationWait: Duration = max(.seconds(12), Umbreld.fallbackDiscoveryTimeLimit) + .seconds(2)
	@State private var enteredAt = ContinuousClock.now
	@State private var advanceTask: Task<Void, Never>?
	@State private var gracePeriodElapsed = false

	var body: some View {
		VStack(spacing: 0) {
			OnboardingHeader(
				title: "Finding your Umbrel",
				subtitle: "Make sure your phone and Umbrel are on the same Wi-Fi network."
			)
			.padding(.top, 90)

			Spacer()

			ZStack {
				RadarRings()
				RadarSweep()
			}
			.accessibilityHidden(true)
			.entrance()

			Spacer()
			Spacer()
		}
		.onChange(of: model.discoveryResults.isEmpty) { _, empty in
			if !empty { advanceAfterDwell() }
		}
		.onChange(of: model.isVerifyingCandidates) {
			showNoDeviceIfNothingFound()
		}
		.task {
			model.startDiscoveryIfNeeded()
			model.startFallbackDiscoveryIfNeeded()
			// Devices may already be present from an earlier scan
			if !model.discoveryResults.isEmpty {
				advanceAfterDwell()
				return
			}
			// Otherwise give discovery a grace period before showing "no device"
			try? await Task.sleep(for: .seconds(12))
			guard !Task.isCancelled else { return }
			gracePeriodElapsed = true
			showNoDeviceIfNothingFound()
			try? await Task.sleep(for: Self.maxVerificationWait - .seconds(12))
			guard !Task.isCancelled else { return }
			showNoDeviceIfNothingFound(waitingForVerification: false)
		}
		.onDisappear {
			advanceTask?.cancel()
		}
	}

	private func showNoDeviceIfNothingFound(waitingForVerification: Bool = true) {
		guard gracePeriodElapsed, model.step == .finding, model.discoveryResults.isEmpty else { return }
		guard !waitingForVerification || !model.isVerifyingCandidates else { return }
		model.advance(to: .noDevice)
	}

	// Move to the results once the minimum dwell has played out (immediately if the
	// discovery took longer than the dwell).
	private func advanceAfterDwell() {
		advanceTask?.cancel()
		advanceTask = Task {
			let remaining = Self.minDwell - enteredAt.duration(to: .now)
			if remaining > .zero { try? await Task.sleep(for: remaining) }
			// Re-check: mDNS can flap; if the device vanished during the dwell, stay on
			// the radar (a re-arrival triggers onChange again).
			guard !Task.isCancelled, model.step == .finding, !model.discoveryResults.isEmpty else { return }
			model.advance(to: .deviceFound)
		}
	}
}

// A glowing radar needle sweeping clockwise around the center: a violet fan wedge
// trails behind the needle, with a white glow along its trailing side and a bright
// capsule on top. All three rotate together around the center of the 360pt field.
struct RadarSweep: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	// Previews can pin the sweep with its needle pointing northeast; the app always spins.
	var spinning = true
	@State private var angle = 0.0

	// How far the glow trails behind the needle, and how bright it is at the needle.
	private static let wakeSpan = 160.0
	private static let wakePeak = 0.58

	// The trailing glow: brightest at the needle, fading with angular distance
	// behind it. Built from many small single-hue stops along a quadratic ease;
	// coarse hand-placed stops put visible kinks in the ramp. The one hard edge
	// sits exactly on the needle's centerline, underneath the needle and its bloom.
	private static let wake: AngularGradient = {
		let start = 1.0 - wakeSpan / 360.0
		var stops: [Gradient.Stop] = [
			.init(color: .clear, location: 0),
			.init(color: .clear, location: start),
		]
		let steps = 48
		for i in 1...steps {
			let t = Double(i) / Double(steps)
			stops.append(
				.init(
					color: Palette.purple.opacity(t * t * wakePeak),
					location: start + t * (wakeSpan / 360.0)
				))
		}
		return AngularGradient(
			gradient: Gradient(stops: stops),
			center: .center,
			startAngle: .degrees(-90),
			endAngle: .degrees(270)
		)
	}()

	var body: some View {
		ZStack {
			Circle().fill(Self.wake)

			// The needle itself
			Needle()
				.stroke(.white, style: StrokeStyle(lineWidth: 5.2, lineCap: .round))
				.shadow(color: .white, radius: 6.7)
		}
		.frame(width: 360, height: 360)
		.rotationEffect(.degrees(angle))
		.onAppear {
			if spinning, !reduceMotion {
				withAnimation(.linear(duration: 2.4).repeatForever(autoreverses: false)) {
					angle = 360
				}
			} else {
				angle = 45
			}
		}
	}

	private struct Needle: Shape {
		func path(in rect: CGRect) -> Path {
			var path = Path()
			path.move(to: CGPoint(x: rect.midX, y: rect.midY))
			path.addLine(to: CGPoint(x: rect.midX, y: rect.midY - 176))
			return path
		}
	}
}

// Radar-only harness for tuning the sweep and glow in the Xcode canvas without
// running the app: no onboarding model, no discovery, just the visuals.
#Preview("Radar") {
	ZStack {
		OnboardingBackground()
		ZStack {
			RadarRings()
			RadarSweep()
		}
	}
}
