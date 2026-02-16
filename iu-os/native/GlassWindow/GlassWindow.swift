
import Cocoa
import WebKit

// Helper classes to maintain app functionality
class DraggableView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override var acceptsTouchEvents: Bool {
        get { return true }
        set { super.acceptsTouchEvents = newValue }
    }
}

class PassThroughWebView: WKWebView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        // Pass clicks through to allow window dragging/interaction
        return nil
    }
}

class GlassWindow: NSWindow {
    // Properties from existing app
    var glassView: NSGlassEffectView!
    var faceView: FaceView!
    private var trackingTimer: Timer?
    private let mode: String
    private var isVisibleState: Bool = false
    private var isCircle = true
    
    // Override key/main window properties
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    
    private let offset: CGPoint = CGPoint(x: 20, y: -20)

    init(mode: String, htmlPath: String) {
        self.mode = mode
        
        super.init(
            contentRect: NSRect(x: 100, y: 100, width: 150, height: 150),
            styleMask: [.borderless, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        
        self.minSize = NSSize(width: 50, height: 50)
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.level = .floating
        self.isMovableByWindowBackground = true
        
        // Main Container
        let mainContainer = NSView(frame: self.contentView!.bounds)
        mainContainer.autoresizingMask = [.width, .height]
        self.contentView = mainContainer
        
        // Content for Glass
        let contentContainer = NSView()
        
        // Glass View
        glassView = NSGlassEffectView()
        glassView.contentView = contentContainer
        glassView.cornerRadius = 32
        glassView.translatesAutoresizingMaskIntoConstraints = false
        mainContainer.addSubview(glassView)
        
        NSLayoutConstraint.activate([
            glassView.topAnchor.constraint(equalTo: mainContainer.topAnchor, constant: 20),
            glassView.bottomAnchor.constraint(equalTo: mainContainer.bottomAnchor, constant: -20),
            glassView.leadingAnchor.constraint(equalTo: mainContainer.leadingAnchor, constant: 20),
            glassView.trailingAnchor.constraint(equalTo: mainContainer.trailingAnchor, constant: -20)
        ])
        
        // Face View
        faceView = FaceView(frame: contentContainer.bounds)
        faceView.autoresizingMask = [.width, .height]
        contentContainer.addSubview(faceView)
        
        setupPinchGesture(on: mainContainer)
        setupKeyMonitoring()
        
        if mode == "cursor" {
            // self.updatePosition() // DISABLED: Stand-by mode
        } else {
            self.center()
        }
    }
    
    // MARK: - Script Logic Implementation
    
    func setupPinchGesture(on view: NSView) {
        let magnification = NSMagnificationGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        view.addGestureRecognizer(magnification)
    }
    
    @objc func handlePinch(_ gesture: NSMagnificationGestureRecognizer) {
        if gesture.state == .changed {
            let currentFrame = self.frame
            let magnification = gesture.magnification
            
            let newWidth = max(50, currentFrame.width * (1 + magnification * 0.5))
            let newHeight = max(50, currentFrame.height * (1 + magnification * 0.5))
            
            // Maintain center
            let centerX = currentFrame.midX
            let centerY = currentFrame.midY
            
            let newFrame = NSRect(
                x: centerX - newWidth / 2,
                y: centerY - newHeight / 2,
                width: newWidth,
                height: newHeight
            )
            
            self.setFrame(newFrame, display: true, animate: false)
            
            if isCircle {
                updateCircleRadius()
            }
        }
    }
    
    func setupKeyMonitoring() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.charactersIgnoringModifiers?.lowercased() == "c" {
                self?.toggleCircle()
                return nil
            }
            return event
        }
    }
    
    func toggleCircle() {
        isCircle.toggle()
        
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.3
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            
            if isCircle {
                updateCircleRadius()
            } else {
                glassView.animator().layer?.cornerRadius = 32
            }
        }
    }
    
    func updateCircleRadius() {
        let size = min(glassView.bounds.width, glassView.bounds.height)
        glassView.layer?.cornerRadius = size / 2
    }
    
    // MARK: - Existing App Logic (show, hide, cursor tracking)
    
    func show() {
        // NSApp.activate(ignoringOtherApps: true) // DISABLED: Don't steal focus
        self.makeKeyAndOrderFront(nil)
        
        if !isVisibleState {
            isVisibleState = true
            // self.updatePosition() // DISABLED
        }
    }
    
    func hide() {
        guard isVisibleState else { return }
        isVisibleState = false
        self.orderOut(nil)
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
        // stopCursorTracking()
        // trackingTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
        //     self?.updatePosition()
        // }
    }
    
    private func stopCursorTracking() {
        trackingTimer?.invalidate()
        trackingTimer = nil
    }
    
    private func updatePosition() {
        // let mouseLoc = NSEvent.mouseLocation
        // let targetX = mouseLoc.x + offset.x
        // let targetY = mouseLoc.y + offset.y
        // self.setFrameOrigin(NSPoint(x: targetX, y: targetY))
    }
}
