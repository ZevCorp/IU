
import Cocoa
import WebKit

// Mocking the requested "NSGlassEffectView" (macOS 26 Tahoe)
// using standard NSVisualEffectView to achieve valid compilation and similar look.
class NSGlassEffectView: NSVisualEffectView {
    
    var contentView: NSView? {
        didSet {
            if let old = oldValue { old.removeFromSuperview() }
            if let new = contentView {
                self.addSubview(new)
                new.translatesAutoresizingMaskIntoConstraints = false
                NSLayoutConstraint.activate([
                    new.topAnchor.constraint(equalTo: self.topAnchor),
                    new.bottomAnchor.constraint(equalTo: self.bottomAnchor),
                    new.leadingAnchor.constraint(equalTo: self.leadingAnchor),
                    new.trailingAnchor.constraint(equalTo: self.trailingAnchor)
                ])
            }
        }
    }
    
    var cornerRadius: CGFloat {
        get { layer?.cornerRadius ?? 0 }
        set {
            wantsLayer = true
            layer?.cornerRadius = newValue
            layer?.masksToBounds = true
        }
    }
    
    override init(frame: NSRect) {
        super.init(frame: frame)
        // Configure for "Liquid Glass" look
        self.material = .hudWindow // Dark, vibrant glass
        self.blendingMode = .behindWindow
        self.state = .active
        self.wantsLayer = true
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

class GlassWindow: NSWindow, WKScriptMessageHandler {
    var glassView: NSGlassEffectView!
    private var webView: WKWebView!
    private var trackingTimer: Timer?
    private let mode: String
    private var isVisibleState: Bool = false
    private var isCircle = false
    
    // Configuration
    private let offset: CGPoint = CGPoint(x: 30, y: -30) // Offset from cursor (Up-Right)

    init(mode: String, htmlPath: String) {
        self.mode = mode
        
        // Window Init
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
            styleMask: [.borderless, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        
        // 1. Window Configuration
        self.isOpaque = false
        self.backgroundColor = .clear
        self.level = .floating
        self.hasShadow = true
        self.isMovableByWindowBackground = true
        
        // 2. Main Container (transparent root)
        let mainContainer = NSView(frame: self.contentRect(forFrameRect: self.frame))
        mainContainer.autoresizingMask = [.width, .height]
        self.contentView = mainContainer
        
        // 3. NSGlassEffectView
        let containerForContent = NSView() // The 'contentView' inside glass
        
        glassView = NSGlassEffectView()
        glassView.contentView = containerForContent
        glassView.cornerRadius = 32 // Start with squircle (or 100 for circle)
        glassView.translatesAutoresizingMaskIntoConstraints = false
        
        mainContainer.addSubview(glassView)
        
        // Constraints with Usage of Padding (Edge Glow Effect)
        NSLayoutConstraint.activate([
            glassView.topAnchor.constraint(equalTo: mainContainer.topAnchor, constant: 20),
            glassView.bottomAnchor.constraint(equalTo: mainContainer.bottomAnchor, constant: -20),
            glassView.leadingAnchor.constraint(equalTo: mainContainer.leadingAnchor, constant: 20),
            glassView.trailingAnchor.constraint(equalTo: mainContainer.trailingAnchor, constant: -20)
        ])
        
        // 4. WebView Setup
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let userContentController = WKUserContentController()
        userContentController.add(self, name: "bridge")
        config.userContentController = userContentController
        
        webView = WKWebView(frame: .zero, configuration: config)
        // NOT enforcing drawsBackground=false as requested, relying on hierarchy
        // wrapping transparency is expected to be handled by CSS if WebView is standard
        webView.setValue(false, forKey: "drawsBackground") // Still keeping this for safety as standard WKWebView is white opaque
        webView.customUserAgent = "IU-Native-Glass/1.0"
        webView.translatesAutoresizingMaskIntoConstraints = false
        
        containerForContent.addSubview(webView)
        
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: containerForContent.topAnchor),
            webView.bottomAnchor.constraint(equalTo: containerForContent.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: containerForContent.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: containerForContent.trailingAnchor)
        ])
        
        // Load Content
        let fileURL = URL(fileURLWithPath: htmlPath)
        webView.loadFileURL(fileURL, allowingReadAccessTo: fileURL.deletingLastPathComponent())
        
        // 5. Interactions
        setupPinchGesture(on: mainContainer)
        setupKeyMonitoring()
        
        if mode == "cursor" {
            startCursorTracking()
        } else {
            self.center()
        }
    }
    
    deinit {
        trackingTimer?.invalidate()
    }
    
    // MARK: - Gestures & Interactions
    
    func setupPinchGesture(on view: NSView) {
        let magnification = NSMagnificationGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        view.addGestureRecognizer(magnification)
    }
    
    @objc func handlePinch(_ gesture: NSMagnificationGestureRecognizer) {
        if gesture.state == .changed {
            let currentFrame = self.frame
            let magnification = gesture.magnification
            
            // Calculate new size
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
                glassView.cornerRadius = 32
            }
        }
    }
    
    func updateCircleRadius() {
        let size = min(glassView.bounds.width, glassView.bounds.height)
        glassView.cornerRadius = size / 2
    }
    
    // MARK: - WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Handle messages
    }
    
    // MARK: - Commands
    
    func show() {
        guard !isVisibleState else { return }
        isVisibleState = true
        
        self.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.3
            self.contentView?.animator().alphaValue = 1.0
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
           // self.orderOut(nil)
        })
        stopCursorTracking()
    }
    
    func setExpression(_ expression: String) {
        let js = "if(window.setExpression) window.setExpression('\(expression)');"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
    
    func updateGaze(x: CGFloat, y: CGFloat) {
        let js = "if(window.lookAt) window.lookAt(\(x), \(y));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
    
    // MARK: - Cursor Logic
    
    private func startCursorTracking() {
        stopCursorTracking()
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
        let mouseLoc = NSEvent.mouseLocation
        let targetX = mouseLoc.x + offset.x
        let targetY = mouseLoc.y + offset.y
        self.setFrameOrigin(NSPoint(x: targetX, y: targetY))
    }
    
    override var canBecomeKey: Bool { return true }
    override var canBecomeMain: Bool { return true }
}
