
import Cocoa

class GlassWindow: NSWindow {
    private var faceView: GlassFace!
    private var trackingTimer: Timer?
    private let mode: String
    private var isVisibleState: Bool = false
    
    // Configuration
    private let windowSize: CGFloat = 222
    private let offset: CGPoint = CGPoint(x: 30, y: -30) // Offset from cursor (Up-Right)

    init(mode: String) {
        self.mode = mode
        
        // Initialize with zero rect, will be positioned immediately
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: windowSize, height: windowSize),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        
        // 1. Window Visuals (Liquid Glass base)
        self.isOpaque = false
        self.backgroundColor = .clear
        self.level = .floating
        self.hasShadow = false
        self.ignoresMouseEvents = true // CLICK-THROUGH ENABLED

        // 2. Visual Effect View (The "Glass" material)
        let visualEffect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: windowSize, height: windowSize))
        visualEffect.material = .hudWindow
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = windowSize / 2
        visualEffect.layer?.masksToBounds = true
        visualEffect.alphaValue = 0.0 // Start hidden
        
        self.contentView = visualEffect
        
        // 3. Native Face View
        faceView = GlassFace(frame: visualEffect.bounds)
        visualEffect.addSubview(faceView)
        
        // 4. Start Cursor Tracking if in cursor mode
        if mode == "cursor" {
            startCursorTracking()
        } else {
            self.center()
        }
    }
    
    deinit {
        trackingTimer?.invalidate()
    }
    
    // MARK: - Commands
    
    func show() {
        guard !isVisibleState else { return }
        isVisibleState = true
        
        self.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.3
            self.contentView?.animator().alphaValue = 0.8
        }
        startCursorTracking()
    }
    
    func hide() {
        guard isVisibleState else { return }
        isVisibleState = false
        
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.3
            self.contentView?.animator().alphaValue = 0.0
        }, completionHandler: {
           // self.orderOut(nil) // Optional: keep it ordered but invisible to avoid flicker on reshow
        })
        stopCursorTracking()
    }
    
    func setExpression(_ expression: String) {
        faceView.setExpression(expression)
    }
    
    func updateGaze(x: CGFloat, y: CGFloat) {
        faceView.lookAt(x: x, y: y)
    }
    
    // MARK: - Cursor Logic
    
    private func startCursorTracking() {
        stopCursorTracking()
        // High frequency update for smooth 60fps feel
        trackingTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
            self?.updatePosition()
        }
    }
    
    private func stopCursorTracking() {
        trackingTimer?.invalidate()
        trackingTimer = nil
    }
    
    private func updatePosition() {
        guard isVisibleState else { return }
        
        // Get global mouse location
        let mouseLoc = NSEvent.mouseLocation
        
        // Target Position: Top-Right of cursor
        let targetX = mouseLoc.x + offset.x
        let targetY = mouseLoc.y + offset.y
        
        // Direct follow
        self.setFrameOrigin(NSPoint(x: targetX, y: targetY))
    }
    
    override var canBecomeKey: Bool { return false }
    override var canBecomeMain: Bool { return false }
}
