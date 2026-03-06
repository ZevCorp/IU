import Foundation

final class DopaminicEngine {
    private var lastPreset: String = "neutral"
    private var lastChangeAt: Date = .distantPast
    private var smoothState: UFaceState = .neutral

    private let cooldown: TimeInterval = 0.9
    private let smoothAlpha: Double = 0.2

    func nextState(from frame: FaceFrame) -> UFaceState {
        let smile = (frame.mouthSmileLeft + frame.mouthSmileRight) * 0.5
        let browUp = (frame.browInnerUp + frame.browOuterUpLeft + frame.browOuterUpRight) / 3
        let browDown = (frame.browDownLeft + frame.browDownRight) * 0.5
        let squint = (frame.eyeSquintLeft + frame.eyeSquintRight) * 0.5
        let jaw = frame.jawOpen

        let basePreset: String
        if smile > 0.5 {
            basePreset = "smile"
        } else if jaw > 0.35 && browUp > 0.35 {
            basePreset = "delighted"
        } else if browUp > 0.35 {
            basePreset = "listening"
        } else if browDown > 0.32 || squint > 0.4 {
            basePreset = "thinking"
        } else {
            basePreset = "neutral"
        }

        let now = Date()
        let shouldHold = now.timeIntervalSince(lastChangeAt) < cooldown
        let preset = shouldHold ? lastPreset : basePreset
        if !shouldHold && preset != lastPreset {
            lastPreset = preset
            lastChangeAt = now
        }

        var target = stateForPreset(preset)

        let eyeLookX = ((frame.eyeLookOutLeft - frame.eyeLookInLeft) + (frame.eyeLookInRight - frame.eyeLookOutRight)) * 0.5
        let eyeLookY = ((frame.eyeLookUpLeft - frame.eyeLookDownLeft) + (frame.eyeLookUpRight - frame.eyeLookDownRight)) * 0.5

        let leftEyeOpen = max(0.0, 1.0 - frame.eyeBlinkLeft)
        let rightEyeOpen = max(0.0, 1.0 - frame.eyeBlinkRight)

        target.leftEyeOpenness = leftEyeOpen
        target.rightEyeOpenness = rightEyeOpen
        target.eyeSquint = max(0.0, min(1.0, squint))
        target.headTilt = max(-10, min(10, frame.roll * 20))
        target.gazeX = max(-8, min(8, eyeLookX * 9))
        target.gazeY = max(-8, min(8, -eyeLookY * 9))

        if smile > 0.6 && Double.random(in: 0 ... 1) < 0.22 {
            target.leftCornerHeight += 0.12
            target.rightCornerHeight += 0.04
        }

        target.confidence = max(0.4, min(0.99, max(smile, browUp, jaw) + 0.2))

        smoothState = mix(smoothState, target, alpha: smoothAlpha)
        smoothState.preset = preset
        smoothState.confidence = target.confidence
        return smoothState
    }

    private func stateForPreset(_ preset: String) -> UFaceState {
        switch preset {
        case "smile":
            return UFaceState(
                preset: preset,
                eyeOpenness: 0.9,
                leftEyeOpenness: -1,
                rightEyeOpenness: -1,
                eyeSquint: 0.16,
                leftBrowHeight: 2,
                rightBrowHeight: 2.5,
                leftBrowCurve: 0.3,
                rightBrowCurve: 0.4,
                mouthCurve: 0.72,
                mouthWidth: 1.08,
                leftCornerHeight: 0.3,
                rightCornerHeight: 0.45,
                mouthOpenness: 0,
                headTilt: 1,
                gazeX: 0,
                gazeY: 0,
                confidence: 0.85
            )
        case "listening":
            return UFaceState(
                preset: preset,
                eyeOpenness: 1.08,
                leftEyeOpenness: -1,
                rightEyeOpenness: -1,
                eyeSquint: 0.02,
                leftBrowHeight: 7,
                rightBrowHeight: 7,
                leftBrowCurve: 0.52,
                rightBrowCurve: 0.52,
                mouthCurve: 0.85,
                mouthWidth: 1.04,
                leftCornerHeight: 0.25,
                rightCornerHeight: 0.25,
                mouthOpenness: 0.04,
                headTilt: 0,
                gazeX: 0,
                gazeY: 0,
                confidence: 0.8
            )
        case "thinking":
            return UFaceState(
                preset: preset,
                eyeOpenness: 0.78,
                leftEyeOpenness: -1,
                rightEyeOpenness: -1,
                eyeSquint: 0.2,
                leftBrowHeight: -1,
                rightBrowHeight: 4,
                leftBrowCurve: 0.1,
                rightBrowCurve: 0.5,
                mouthCurve: 0.68,
                mouthWidth: 0.95,
                leftCornerHeight: 0.1,
                rightCornerHeight: 0.12,
                mouthOpenness: 0,
                headTilt: 5,
                gazeX: 0,
                gazeY: 0,
                confidence: 0.76
            )
        case "delighted":
            return UFaceState(
                preset: preset,
                eyeOpenness: 1.0,
                leftEyeOpenness: -1,
                rightEyeOpenness: -1,
                eyeSquint: 0.1,
                leftBrowHeight: 5,
                rightBrowHeight: 5,
                leftBrowCurve: 0.55,
                rightBrowCurve: 0.55,
                mouthCurve: 0.65,
                mouthWidth: 1.15,
                leftCornerHeight: 0.42,
                rightCornerHeight: 0.42,
                mouthOpenness: 0.28,
                headTilt: 0,
                gazeX: 0,
                gazeY: 0,
                confidence: 0.88
            )
        default:
            return .neutral
        }
    }

    private func mix(_ current: UFaceState, _ target: UFaceState, alpha: Double) -> UFaceState {
        func m(_ c: Double, _ t: Double) -> Double {
            c + ((t - c) * alpha)
        }

        return UFaceState(
            preset: target.preset,
            eyeOpenness: m(current.eyeOpenness, target.eyeOpenness),
            leftEyeOpenness: m(current.leftEyeOpenness, target.leftEyeOpenness),
            rightEyeOpenness: m(current.rightEyeOpenness, target.rightEyeOpenness),
            eyeSquint: m(current.eyeSquint, target.eyeSquint),
            leftBrowHeight: m(current.leftBrowHeight, target.leftBrowHeight),
            rightBrowHeight: m(current.rightBrowHeight, target.rightBrowHeight),
            leftBrowCurve: m(current.leftBrowCurve, target.leftBrowCurve),
            rightBrowCurve: m(current.rightBrowCurve, target.rightBrowCurve),
            mouthCurve: m(current.mouthCurve, target.mouthCurve),
            mouthWidth: m(current.mouthWidth, target.mouthWidth),
            leftCornerHeight: m(current.leftCornerHeight, target.leftCornerHeight),
            rightCornerHeight: m(current.rightCornerHeight, target.rightCornerHeight),
            mouthOpenness: m(current.mouthOpenness, target.mouthOpenness),
            headTilt: m(current.headTilt, target.headTilt),
            gazeX: m(current.gazeX, target.gazeX),
            gazeY: m(current.gazeY, target.gazeY),
            confidence: target.confidence
        )
    }
}
