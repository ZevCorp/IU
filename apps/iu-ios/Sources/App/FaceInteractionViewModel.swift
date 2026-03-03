import Foundation
import Combine

@MainActor
final class FaceInteractionViewModel: ObservableObject {
    @Published var statusText: String = "Starting Ü..."

    let tracker = TrueDepthFaceTracker()
    let webBridge = UFaceWebBridge()
    private let dopaminic = DopaminicEngine()

    var isTrueDepthSupported: Bool {
        tracker.isSupported
    }

    init() {
        tracker.onFrame = { [weak self] frame in
            guard let self else { return }
            let state = self.dopaminic.nextState(from: frame)
            self.webBridge.send(state: state)
            self.statusText = "\(state.preset) • confidence \(Int(state.confidence * 100))%"
        }

        webBridge.onReady = { [weak self] in
            self?.statusText = "Ü connected"
        }
    }

    func start() {
        guard isTrueDepthSupported else {
            statusText = "TrueDepth unavailable"
            return
        }
        tracker.start()
        statusText = "Reading face..."
    }

    func stop() {
        tracker.stop()
        statusText = "Paused"
    }
}
