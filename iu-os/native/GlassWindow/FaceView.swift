
import Cocoa
import QuartzCore

class FaceView: NSView {
    
    // Layers
    private let containerLayer = CALayer()
    private let faceOutline = CAShapeLayer()
    private let leftEyeGroup = CALayer()
    private let rightEyeGroup = CALayer()
    private let mouth = CAShapeLayer()
    
    // Eye components (duplicated for left/right)
    private let leftEyeBg = CAShapeLayer()
    private let leftIris = CAShapeLayer()
    private let leftPupil = CAShapeLayer()
    private let leftHighlight = CAShapeLayer()
    private let leftEyelid = CAShapeLayer()
    
    private let rightEyeBg = CAShapeLayer()
    private let rightIris = CAShapeLayer()
    private let rightPupil = CAShapeLayer()
    private let rightHighlight = CAShapeLayer()
    private let rightEyelid = CAShapeLayer()
    
    // State
    private var currentState: String = "idle"
    private var blinkTimer: Timer?
    private var breatheTimer: Timer?
    
    // Constants
    private let colorBlue = NSColor(red: 0, green: 0.83, blue: 1, alpha: 1).cgColor // #00d4ff
    private let colorPurple = NSColor(red: 0.69, green: 0.26, blue: 1, alpha: 1).cgColor // #b042ff
    private let colorPink = NSColor(red: 1, green: 0, blue: 0.43, alpha: 1).cgColor // #ff006e
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupLayers()
        startAmbientAnimations()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override var wantsUpdateLayer: Bool { true }
    
    private func setupLayers() {
        self.wantsLayer = true
        self.layer = CALayer()
        self.layer?.addSublayer(containerLayer)
        
        // Setup container to scale 100x100 coordinate system to view bounds
        containerLayer.frame = self.bounds
        // We will update scaling in layout
        
        // 1. Face Outline
        // <circle cx="50" cy="50" r="45" ... />
        setupShape(faceOutline, path: CGPath(ellipseIn: CGRect(x: 5, y: 5, width: 90, height: 90), transform: nil))
        faceOutline.fillColor = nil
        faceOutline.strokeColor = colorBlue
        faceOutline.lineWidth = 0.5
        faceOutline.opacity = 0.3
        
        // Glow effect for outline
        faceOutline.shadowColor = colorBlue
        faceOutline.shadowRadius = 5
        faceOutline.shadowOpacity = 0.5
        faceOutline.shadowOffset = .zero
        
        containerLayer.addSublayer(faceOutline)
        
        // 2. Eyes
        // Left Eye Group: translate(30, 40) relative to 100x100
        setupEye(group: leftEyeGroup, bg: leftEyeBg, iris: leftIris, pupil: leftPupil, highlight: leftHighlight, eyelid: leftEyelid, x: 30, y: 40)
        setupEye(group: rightEyeGroup, bg: rightEyeBg, iris: rightIris, pupil: rightPupil, highlight: rightHighlight, eyelid: rightEyelid, x: 70, y: 40)
        
        containerLayer.addSublayer(leftEyeGroup)
        containerLayer.addSublayer(rightEyeGroup)
        
        // 3. Mouth
        // d="M 35 65 Q 50 70 65 65"
        mouth.fillColor = nil
        mouth.strokeColor = colorBlue
        mouth.lineWidth = 2.0
        mouth.lineCap = .round
        mouth.shadowColor = colorBlue
        mouth.shadowRadius = 4
        mouth.shadowOpacity = 0.8
        mouth.shadowOffset = .zero
        updateMouthPath(controlPointY: 70) // Default idle
        
        containerLayer.addSublayer(mouth)
    }
    
    private func setupShape(_ layer: CAShapeLayer, path: CGPath) {
        layer.path = path
    }
    
    private func setupEye(group: CALayer, bg: CAShapeLayer, iris: CAShapeLayer, pupil: CAShapeLayer, highlight: CAShapeLayer, eyelid: CAShapeLayer, x: CGFloat, y: CGFloat) {
        group.position = CGPoint(x: x, y: y)
        // Ensure bounds are big enough to hold eye parts relative to 0,0 center
        // Although the SVG uses cx=0 cy=0, so layers should be placed relative to group position
        
        // BG: rx=8 ry=10
        let bgPath = CGPath(ellipseIn: CGRect(x: -8, y: -10, width: 16, height: 20), transform: nil)
        bg.path = bgPath
        bg.fillColor = NSColor(white: 0.04, alpha: 1).cgColor // #0a0a0a
        group.addSublayer(bg)
        
        // Iris: rx=5 ry=6
        let irisPath = CGPath(ellipseIn: CGRect(x: -5, y: -6, width: 10, height: 12), transform: nil)
        iris.path = irisPath
        iris.fillColor = colorBlue
        iris.shadowColor = colorBlue
        iris.shadowRadius = 4
        iris.shadowOpacity = 0.8
        iris.shadowOffset = .zero
        group.addSublayer(iris)
        
        // Pupil: rx=2 ry=3
        let pupilPath = CGPath(ellipseIn: CGRect(x: -2, y: -3, width: 4, height: 6), transform: nil)
        pupil.path = pupilPath
        pupil.fillColor = NSColor.black.cgColor
        group.addSublayer(pupil)
        
        // Highlight: cx=2 cy=-2 rx=1.5 ry=1
        let highlightPath = CGPath(ellipseIn: CGRect(x: 2 - 1.5, y: -2 - 1, width: 3, height: 2), transform: nil)
        highlight.path = highlightPath
        highlight.fillColor = NSColor.white.cgColor
        highlight.opacity = 0.8
        group.addSublayer(highlight)
        
        // Eyelid: cx=0 cy=-10 rx=9 ry=10 (starts hidden/open)
        // To make it look like a lid closing from top, we can use a clipping mask or just an opaque shape on top
        // SVG implementation uses opacity. Let's stick to that.
        let eyelidPath = CGPath(ellipseIn: CGRect(x: -9, y: -20, width: 18, height: 20), transform: nil)
        eyelid.path = eyelidPath
        eyelid.fillColor = NSColor.black.cgColor
        eyelid.opacity = 0.0
        group.addSublayer(eyelid)
    }
    
    override func layout() {
        super.layout()
        
        // Maintain aspect ratio close to 1:1 and scale
        let minDim = min(self.bounds.width, self.bounds.height)
        let scale = minDim / 100.0
        
        containerLayer.sublayerTransform = CATransform3DMakeScale(scale, scale, 1)
        
        // Center the container
        let xOffset = (self.bounds.width - minDim) / 2
        let yOffset = (self.bounds.height - minDim) / 2
        containerLayer.frame = CGRect(x: xOffset, y: yOffset, width: minDim, height: minDim)
        
        // Important: SVG 0,0 is top-left. Core Animation is bottom-left by default unless view is flipped.
        // We can just flip the container geometry
        if !self.isFlipped {
             containerLayer.sublayerTransform = CATransform3DConcat(
                 CATransform3DMakeScale(scale, -scale, 1),
                 CATransform3DMakeTranslation(0, 100, 0) // Shift down to compensate flip
             )
        }
    }
    
    // We want convenient coordinates (0,0 top left) like SVG
    override var isFlipped: Bool { true }
    
    // MARK: - Animation Logic
    
    private func startAmbientAnimations() {
        // Blink every ~3s with randomness
        blinkTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            if Double.random(in: 0...1) > 0.3 {
                self?.blink()
            }
        }
        
        // Breathe
        breathe()
    }
    
    private func blink() {
        // Animate eyelid opacity
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = [0, 1, 0]
        animation.keyTimes = [0, 0.5, 1]
        animation.duration = 0.15
        
        leftEyelid.add(animation, forKey: "blink")
        rightEyelid.add(animation, forKey: "blink")
    }
    
    private func breathe() {
        // SVG: scale from 1 to 1.02
        let animation = CABasicAnimation(keyPath: "transform.scale")
        animation.fromValue = 1.0
        animation.toValue = 1.02
        animation.duration = 2.0
        animation.autoreverses = true
        animation.repeatCount = .infinity
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        
        leftEyeGroup.add(animation, forKey: "breathe")
        rightEyeGroup.add(animation, forKey: "breathe")
    }
    
    // MARK: - Control Methods
    
    func setExpression(_ expression: String) {
        // Verify current state is different? or just apply
        self.currentState = expression
        
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.3)
        
        switch expression {
        case "happy":
            updateMouthPath(controlPointY: 75) // Smile
            setEyeColor(colorBlue)
            leftEyelid.opacity = 0
            rightEyelid.opacity = 0
            
        case "thinking":
            updateMouthPath(controlPointY: 65) // Flat
            setEyeColor(colorPurple)
            leftEyelid.opacity = 0.3
            rightEyelid.opacity = 0.3
            
        case "attention":
            updateMouthPath(controlPointY: 68) // Slightly open/alert
            setEyeColor(colorPink)
            leftEyelid.opacity = 0
            rightEyelid.opacity = 0
            // Widen eyes logic could go here
            
        default: // idle
            updateMouthPath(controlPointY: 70)
            setEyeColor(colorBlue)
            leftEyelid.opacity = 0
            rightEyelid.opacity = 0
        }
        
        CATransaction.commit()
    }
    
    func lookAt(x: CGFloat, y: CGFloat) { // x,y in 0..1
        // SVG logic: const offsetX = (x - 0.5) * 3;
        let pX = (x - 0.5) * 3
        let pY = (y - 0.5) * 2 // SVG y is down, here is also down due to isFlipped=true
        
        CATransaction.begin()
        CATransaction.setDisableActions(true) // Instant update for tracking
        
        updatePupilPos(layer: leftPupil, baseX: -2, baseY: -3, offX: pX, offY: pY)
        updatePupilPos(layer: rightPupil, baseX: -2, baseY: -3, offX: pX, offY: pY)
        
        // Highlights move half as much
        let hX = pX * 0.5
        let hY = pY * 0.5
        updatePupilPos(layer: leftHighlight, baseX: 2 - 1.5, baseY: -2 - 1, offX: hX, offY: hY)
        updatePupilPos(layer: rightHighlight, baseX: 2 - 1.5, baseY: -2 - 1, offX: hX, offY: hY)
        
        CATransaction.commit()
    }
    
    private func updatePupilPos(layer: CAShapeLayer, baseX: CGFloat, baseY: CGFloat, offX: CGFloat, offY: CGFloat) {
        // layer.path takes a rect, we can translate the layer itself or update path
        // Easier to translate layer position if anchor was center, but here we drew paths relative to 0,0
        // We need to re-create path shifted
        // Or simpler: use affine transform on the layer
        layer.setAffineTransform(CGAffineTransform(translationX: offX, y: offY))
    }
    
    private func updateMouthPath(controlPointY: CGFloat) {
        // M 35 65 Q 50 <CY> 65 65
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 35, y: 65))
        path.addQuadCurve(to: CGPoint(x: 65, y: 65), control: CGPoint(x: 50, y: controlPointY))
        mouth.path = path
    }
    
    private func setEyeColor(_ color: CGColor) {
        leftIris.fillColor = color
        rightIris.fillColor = color
        leftIris.shadowColor = color
        mouth.strokeColor = color
        mouth.shadowColor = color
    }
}
