
import Cocoa
import Foundation

// Application Delegate
class AppDelegate: NSObject, NSApplicationDelegate {
    var window: GlassWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Parse args
        let args = ProcessInfo.processInfo.arguments
        let mode = args.count > 1 ? args[1] : "cursor"

        // Create Window (Hidden by default)
        window = GlassWindow(mode: mode)
        
        // Start Input Loop
        startStandardInputReader()
    }
    
    func startStandardInputReader() {
        let input = FileHandle.standardInput
        
        input.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard data.count > 0 else { return }
            
            if let string = String(data: data, encoding: .utf8) {
                // Split by newline in case multiple commands arrive at once
                let lines = string.components(separatedBy: .newlines)
                for line in lines where !line.isEmpty {
                    DispatchQueue.main.async {
                        self?.handleCommand(line)
                    }
                }
            }
        }
    }
    
    func handleCommand(_ command: String) {
        // Simple JSON parsing
        guard let data = command.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
              let action = json["command"] as? String else {
            return
        }
        
        switch action {
        case "show":
            window.show()
        case "hide":
            window.hide()
        case "expression":
            if let state = json["state"] as? String {
                window.setExpression(state)
            }
        case "gaze":
            if let x = json["x"] as? CGFloat, let y = json["y"] as? CGFloat {
                window.updateGaze(x: x, y: y)
            }
        case "quit":
            NSApp.terminate(nil)
        default:
            break
        }
    }
}

// Main Execution
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) 
app.run()
