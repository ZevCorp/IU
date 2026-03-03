import SwiftUI

struct ContentView: View {
    @StateObject private var model = FaceInteractionViewModel()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if model.isTrueDepthSupported {
                UFaceWebView(bridge: model.webBridge)
                    .ignoresSafeArea()
                    .onAppear {
                        model.start()
                    }
                    .onDisappear {
                        model.stop()
                    }
            } else {
                VStack(spacing: 12) {
                    Text("TrueDepth not available")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                    Text("Run on an iPhone with Face ID to enable high-precision facial interaction.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(.horizontal, 24)
                }
            }

            VStack {
                HStack {
                    Text(model.statusText)
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.45), in: Capsule())
                        .foregroundStyle(.white)
                    Spacer()
                }
                .padding(16)
                Spacer()
            }
        }
    }
}

#Preview {
    ContentView()
}
