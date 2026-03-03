import ARKit
import Foundation
import simd

final class TrueDepthFaceTracker: NSObject, ARSessionDelegate {
    let isSupported = ARFaceTrackingConfiguration.isSupported
    private let session = ARSession()
    var onFrame: ((FaceFrame) -> Void)?

    func start() {
        guard isSupported else { return }
        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = true
        session.delegate = self
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let faceAnchor = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }

        let b = faceAnchor.blendShapes

        let frame = FaceFrame(
            browInnerUp: value(.browInnerUp, in: b),
            browOuterUpLeft: value(.browOuterUpLeft, in: b),
            browOuterUpRight: value(.browOuterUpRight, in: b),
            browDownLeft: value(.browDownLeft, in: b),
            browDownRight: value(.browDownRight, in: b),
            mouthSmileLeft: value(.mouthSmileLeft, in: b),
            mouthSmileRight: value(.mouthSmileRight, in: b),
            jawOpen: value(.jawOpen, in: b),
            mouthPucker: value(.mouthPucker, in: b),
            eyeBlinkLeft: value(.eyeBlinkLeft, in: b),
            eyeBlinkRight: value(.eyeBlinkRight, in: b),
            eyeSquintLeft: value(.eyeSquintLeft, in: b),
            eyeSquintRight: value(.eyeSquintRight, in: b),
            eyeLookInLeft: value(.eyeLookInLeft, in: b),
            eyeLookOutLeft: value(.eyeLookOutLeft, in: b),
            eyeLookInRight: value(.eyeLookInRight, in: b),
            eyeLookOutRight: value(.eyeLookOutRight, in: b),
            eyeLookUpLeft: value(.eyeLookUpLeft, in: b),
            eyeLookUpRight: value(.eyeLookUpRight, in: b),
            eyeLookDownLeft: value(.eyeLookDownLeft, in: b),
            eyeLookDownRight: value(.eyeLookDownRight, in: b),
            pitch: rotationPitch(from: faceAnchor.transform),
            yaw: rotationYaw(from: faceAnchor.transform),
            roll: rotationRoll(from: faceAnchor.transform)
        )

        onFrame?(frame)
    }

    private func value(_ key: ARFaceAnchor.BlendShapeLocation, in dict: [ARFaceAnchor.BlendShapeLocation: NSNumber]) -> Double {
        dict[key]?.doubleValue ?? 0
    }

    private func rotationPitch(from matrix: simd_float4x4) -> Double {
        let m = matrix
        return atan2(-Double(m.columns.2.y), sqrt(pow(Double(m.columns.0.y), 2) + pow(Double(m.columns.1.y), 2)))
    }

    private func rotationYaw(from matrix: simd_float4x4) -> Double {
        let m = matrix
        return atan2(Double(m.columns.2.x), Double(m.columns.2.z))
    }

    private func rotationRoll(from matrix: simd_float4x4) -> Double {
        let m = matrix
        return atan2(Double(m.columns.0.y), Double(m.columns.1.y))
    }
}
