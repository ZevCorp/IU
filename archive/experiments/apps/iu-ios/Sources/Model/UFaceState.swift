import Foundation

struct UFaceState: Codable {
    var preset: String
    var eyeOpenness: Double
    var leftEyeOpenness: Double
    var rightEyeOpenness: Double
    var eyeSquint: Double
    var leftBrowHeight: Double
    var rightBrowHeight: Double
    var leftBrowCurve: Double
    var rightBrowCurve: Double
    var mouthCurve: Double
    var mouthWidth: Double
    var leftCornerHeight: Double
    var rightCornerHeight: Double
    var mouthOpenness: Double
    var headTilt: Double
    var gazeX: Double
    var gazeY: Double
    var confidence: Double

    static let neutral = UFaceState(
        preset: "neutral",
        eyeOpenness: 0.88,
        leftEyeOpenness: -1,
        rightEyeOpenness: -1,
        eyeSquint: 0.12,
        leftBrowHeight: -0.5,
        rightBrowHeight: 3,
        leftBrowCurve: 0.15,
        rightBrowCurve: 0.45,
        mouthCurve: 0.55,
        mouthWidth: 0.95,
        leftCornerHeight: 0.05,
        rightCornerHeight: 0.45,
        mouthOpenness: 0,
        headTilt: 4,
        gazeX: 0,
        gazeY: 0,
        confidence: 0.6
    )
}
