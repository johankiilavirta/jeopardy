import AudioToolbox
import CoreHaptics
import ExpoModulesCore

/**
 * A sustained game-show buzzer cue. UIKit's standard feedback generators
 * only expose short semantic taps; Core Haptics lets us hold maximum
 * intensity long enough to feel unmistakable in a hand or on a table.
 */
public final class BuzzHapticsModule: Module {
  private var engine: CHHapticEngine?
  private var player: CHHapticPatternPlayer?

  public func definition() -> ModuleDefinition {
    Name("BuzzHaptics")

    Function("buzz") { () -> Bool in
      guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        return false
      }

      do {
        let engine = try self.makeEngine()
        let events = [
          CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
              CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
              CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.8),
            ],
            relativeTime: 0
          ),
          CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
              CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.9),
              CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.55),
            ],
            relativeTime: 0.03,
            duration: 0.37
          ),
          CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
              CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
              CHHapticEventParameter(parameterID: .hapticSharpness, value: 1),
            ],
            relativeTime: 0.40
          ),
        ]
        let pattern = try CHHapticPattern(events: events, parameters: [])
        let player = try engine.makePlayer(with: pattern)
        self.player = player
        try engine.start()
        try player.start(atTime: CHHapticTimeImmediate)
        return true
      } catch {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        return false
      }
    }
  }

  private func makeEngine() throws -> CHHapticEngine {
    if let engine {
      return engine
    }
    let created = try CHHapticEngine()
    created.playsHapticsOnly = true
    created.isAutoShutdownEnabled = true
    created.resetHandler = { [weak self] in
      try? self?.engine?.start()
    }
    self.engine = created
    return created
  }
}
