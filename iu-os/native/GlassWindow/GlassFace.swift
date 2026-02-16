
import Cocoa
import QuartzCore

class GlassFace: NSView {
    // Layers
    private let faceLayer = CALayer()
    private let leftEyeGroup = CALayer()
    private let rightEyeGroup = CALayer()
    private let mouthLayer = CAShapeLayer()
    
    // Left Eye Parts
    private let leftIris = CAShapeLayer()
    private let leftPupil = CAShapeLayer()
    private let leftHighlight = CAShapeLayer()
    private let leftEyelid = CAShapeLayer()
    
    // Right Eye Parts
    private let rightIris = CAShapeLayer()
    private let rightPupil = CAShapeLayer()
    private let rightHighlight = CAShapeLayer()
    private let rightEyelid = CAShapeLayer()
    
    // Gradient for Glow
    private let gradientLayer = CAGradientLayer()
    
    // State
    private var currentState: String = "idle"
    private var blinkTimer: Timer?
    private var breatheTimer: Timer?
    
    // Constants
    private let faceSize: CGFloat = 100.0 // Coordinate space
    private let eyeY: CGFloat = 40.0
    private let leftEyeX: CGFloat = 30.0
    private let rightEyeX: CGFloat = 70.0
    
    override init(frame: NSRect) {
        super.init(frame: frame)
        self.wantsLayer = true
        setupLayers()
        startAmbientAnimations()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupLayers() {
        guard let layer = self.layer else { return }
        
        // Scale layer to fit view
        // Our coordinate system is 100x100. We scale it up.
        let scale = min(self.bounds.width, self.bounds.height) / faceSize
        faceLayer.frame = CGRect(x: (self.bounds.width - scale * faceSize) / 2,
                                 y: (self.bounds.height - scale * faceSize) / 2,
                                 width: scale * faceSize,
                                 height: scale * faceSize)
        // Flip geometry because CAShapeLayer uses bottom-left origin usually, but we want top-left matching SVG?
        // Actually, let's stick to standard Core Graphics (Bottom-Left 0,0) or flip it. 
        // SVG (0,0) is Top-Left. Cocoa (0,0) is Bottom-Left.
        // To match SVG logic (Y goes down), we can flip the layer.
        faceLayer.transform = CATransform3DMakeScale(1, -1, 1) // Flip Y
        // Wait, transforming the container might be confusing. Let's just do math.
        // SVG Y=40 is 40% down. Cocoa Y=60 is 40% down.
        // Actually, strictly mapping SVG coordinates is easier if we conceptually flip.
        
        layer.addSublayer(faceLayer)
        
        // Face Glow (Gradient)
        // In SVG it was a stroke gradient. Here we can use a shadow or stroke.
        // Simplified: Just use shadows for glow.
        
        // Left Eye Group
        setupEye(group: leftEyeGroup, iris: leftIris, pupil: leftPupil, highlight: leftHighlight, eyelid: leftEyelid, x: leftEyeX)
        faceLayer.addSublayer(leftEyeGroup)
        
        // Right Eye Group
        setupEye(group: rightEyeGroup, iris: rightIris, pupil: rightPupil, highlight: rightHighlight, eyelid: rightEyelid, x: rightEyeX)
        faceLayer.addSublayer(rightEyeGroup)
        
        // Mouth
        mouthLayer.fillColor = nil
        mouthLayer.lineWidth = 2.0
        mouthLayer.lineCap = .round
        faceLayer.addSublayer(mouthLayer)
        
        setExpression("idle")
    }
    
    private func setupEye(group: CALayer, iris: CAShapeLayer, pupil: CAShapeLayer, highlight: CAShapeLayer, eyelid: CAShapeLayer, x: CGFloat) {
        // SVG coords: cx=x, cy=40
        // We'll map 0..100 to frame coords manually for simpler mental model without flipping layer
        // Y=0 is bottom in Cocoa. Y=100 is top.
        // SVG Y=40 means 40 from top -> 60 from bottom.
        
        let py = faceSize - eyeY // 60
        
        group.position = CGPoint(x: x, y: py)
        group.bounds = CGRect(x: 0, y: 0, width: 20, height: 20) // Local bounds
        
        // Iris (Cyan/Blue)
        let irisPath = CGPath(ellipseIn: CGRect(x: -5, y: -6, width: 10, height: 12), transform: nil)
        iris.path = irisPath
        iris.fillColor = NSColor(red: 0, green: 0.83, blue: 1, alpha: 1).cgColor // #00d4ff
        iris.shadowColor = iris.fillColor
        iris.shadowOpacity = 0.8
        iris.shadowRadius = 4
        iris.shadowOffset = .zero
        group.addSublayer(iris)
        
        // Pupil (Black)
        let pupilPath = CGPath(ellipseIn: CGRect(x: -2, y: -3, width: 4, height: 6), transform: nil)
        pupil.path = pupilPath
        pupil.fillColor = NSColor.black.cgColor
        group.addSublayer(pupil)
        
        // Highlight (White)
        let highlightPath = CGPath(ellipseIn: CGRect(x: 2, y: 2, width: 3, height: 2), transform: nil) // Offset logic inverted slightly for Y
        highlight.path = highlightPath
        highlight.fillColor = NSColor.white.cgColor
        highlight.opacity = 0.8
        group.addSublayer(highlight)
        
        // Eyelid (Black cover)
        // In SVG it translates to cover opacity 0 -> 1.
        // Here we can use a shape that covers the eye.
        let eyelidPath = CGPath(ellipseIn: CGRect(x: -9, y: -10, width: 18, height: 20), transform: nil)
        eyelid.path = eyelidPath
        eyelid.fillColor = NSColor.black.cgColor
        eyelid.opacity = 0
        // Anchor point for blink? Just opacity is easiest.
        group.addSublayer(eyelid)
    }
    
    // MARK: - Expressions
    
    func setExpression(_ expression: String) {
        self.currentState = expression
        
        var eyeColor: CGColor = NSColor(red: 0, green: 0.83, blue: 1, alpha: 1).cgColor
        var mouthPathVal: CGPath?
        var eyelidOpacity: Float = 0.0
        var irisScaleY: CGFloat = 1.0
        
        // Coordinates (Y is flipped: 0 bottom, 100 top)
        // SVG Y=65 -> Cocoa Y=35
        // SVG Y=70 -> Cocoa Y=30 -> Curve down
        // SVG Y=60 -> Cocoa Y=40 -> Curve up (Smile)
        
        switch expression {
        case "happy":
            // Smile
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 35, y: 38)) // 100-62
            path.addQuadCurve(to: CGPoint(x: 65, y: 38), control: CGPoint(x: 50, y: 25)) // 100-75
            mouthPathVal = path
            eyeColor = NSColor(red: 0, green: 0.83, blue: 1, alpha: 1).cgColor
            
        case "thinking":
            // Flat/Slight wobble
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 40, y: 35))
            path.addQuadCurve(to: CGPoint(x: 60, y: 35), control: CGPoint(x: 50, y: 35))
            mouthPathVal = path
            eyeColor = NSColor(red: 0.69, green: 0.26, blue: 1, alpha: 1).cgColor // #b042ff
            eyelidOpacity = 0.3
            
        case "attention":
            // O shape / slightly open
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 35, y: 35))
            path.addQuadCurve(to: CGPoint(x: 65, y: 35), control: CGPoint(x: 50, y: 32)) 
            mouthPathVal = path
            eyeColor = NSColor(red: 1, green: 0, blue: 0.43, alpha: 1).cgColor // #ff006e
            irisScaleY = 1.2 // Widen eyes
            
        default: // idle
            // Gentle curve
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 35, y: 35))
            path.addQuadCurve(to: CGPoint(x: 65, y: 35), control: CGPoint(x: 50, y: 30))
            mouthPathVal = path
            eyeColor = NSColor(red: 0, green: 0.83, blue: 1, alpha: 1).cgColor
        }
        
        // Animate changes
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.3)
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeInEaseOut))
        
        mouthLayer.path = mouthPathVal
        mouthLayer.strokeColor = eyeColor
        mouthLayer.shadowColor = eyeColor
        mouthLayer.shadowOpacity = 0.6
        mouthLayer.shadowRadius = 3
        
        leftIris.fillColor = eyeColor
        rightIris.fillColor = eyeColor
        leftIris.shadowColor = eyeColor
        rightIris.shadowColor = eyeColor
        
        leftEyelid.opacity = eyelidOpacity
        rightEyelid.opacity = eyelidOpacity
        
        // Scale iris for attention
        // Reset transform first?
        leftIris.transform = CATransform3DMakeScale(1, irisScaleY, 1)
        rightIris.transform = CATransform3DMakeScale(1, irisScaleY, 1)
        
        CATransaction.commit()
    }
    
    // MARK: - Gaze
    
    func lookAt(x: CGFloat, y: CGFloat) {
        // x, y are 0..1
        // Range 0..1 -> -3..+3 offset
        let offsetX = (x - 0.5) * 6
        let offsetY = -(y - 0.5) * 4 // Inverted for Y (top is 0 in input, but top is 100 in Cocoa? No, let's assume input is standard 0=top)
        
        // Calculate pupil position
        let pupilTrans = CATransform3DMakeTranslation(offsetX, offsetY, 0)
        let highlightTrans = CATransform3DMakeTranslation(offsetX * 0.5, offsetY * 0.5, 0)
        
        // Disable implicit animation for gaze (snappy)
        CATransaction.begin()
        CATransaction.setDisableActions(true) // Fast response
        
        leftPupil.transform = pupilTrans
        rightPupil.transform = pupilTrans
        leftHighlight.transform = highlightTrans
        rightHighlight.transform = highlightTrans
        
        CATransaction.commit()
    }

    // MARK: - Ambient Animations
    
    private func startAmbientAnimations() {
        // Blink
        blinkTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            if Float.random(in: 0...1) > 0.7 { self?.blink() }
        }
        
        // Breathe (Scale)
        // Using CAAnimation for smooth loop
        let breatheAnim = CABasicAnimation(keyPath: "transform.scale")
        breatheAnim.fromValue = 1.0
        breatheAnim.toValue = 1.02
        breatheAnim.duration = 2.0
        breatheAnim.autoreverses = true
        breatheAnim.repeatCount = .infinity
        breatheAnim.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        
        leftEyeGroup.add(breatheAnim, forKey: "breathe")
        rightEyeGroup.add(breatheAnim, forKey: "breathe")
    }
    
    private func blink() {
        // Don't blink if opacity is heavily set (thinking/sleeping)
        guard leftEyelid.opacity < 0.5 else { return }
        
        let blinkAnim = CABasicAnimation(keyPath: "opacity")
        blinkAnim.fromValue = 0
        blinkAnim.toValue = 1
        blinkAnim.duration = 0.1
        blinkAnim.autoreverses = true
        blinkAnim.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        
        leftEyelid.add(blinkAnim, forKey: "blink")
        rightEyelid.add(blinkAnim, forKey: "blink")
    }
    
    override func layout() {
        super.layout()
        // Rescale if view changes size
        let scale = min(self.bounds.width, self.bounds.height) / faceSize
        faceLayer.frame = CGRect(x: (self.bounds.width - scale * faceSize) / 2,
                                 y: (self.bounds.height - scale * faceSize) / 2,
                                 width: scale * faceSize,
                                 height: scale * faceSize)
    }
}
