param(
    [string]$RequestJson = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32Native {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
}
"@

function Write-HostLog {
    param([string]$Message)
    [Console]::Error.WriteLine("[WindowsCompanion] $Message")
}

function Safe-Text {
    param($Value)
    if ($null -eq $Value) { return "" }
    $text = [string]$Value
    if ($text.Length -gt 180) {
        return $text.Substring(0, 180)
    }
    return $text
}

function Normalize-AppName {
    param([string]$AppName)
    $raw = ""
    if (-not [string]::IsNullOrWhiteSpace($AppName)) {
        $raw = $AppName.Trim()
    }
    if ([string]::IsNullOrWhiteSpace($raw)) { return "" }

    $map = @{
        "calculadora" = "ms-calculator:"
        "calculator" = "ms-calculator:"
        "calc" = "ms-calculator:"
        "bloc de notas" = "notepad.exe"
        "notepad" = "notepad.exe"
        "explorador" = "explorer.exe"
        "explorer" = "explorer.exe"
        "cmd" = "cmd.exe"
        "terminal" = "wt.exe"
        "powerpoint" = "POWERPNT.EXE"
        "excel" = "EXCEL.EXE"
        "word" = "WINWORD.EXE"
    }

    $key = $raw.ToLowerInvariant()
    if ($map.ContainsKey($key)) {
        return $map[$key]
    }

    if ($raw.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        return $raw
    }

    return $raw
}

function Get-VirtualScreenInfo {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    return @{
        left = [double]$bounds.Left
        top = [double]$bounds.Top
        width = [double]$bounds.Width
        height = [double]$bounds.Height
    }
}

function Convert-ControlTypeName {
    param([System.Windows.Automation.AutomationElement]$Element)
    try {
        $programmatic = $Element.Current.ControlType.ProgrammaticName
        if ([string]::IsNullOrWhiteSpace($programmatic)) { return "Unknown" }
        $parts = $programmatic.Split(".")
        return $parts[$parts.Length - 1]
    } catch {
        return "Unknown"
    }
}

function Convert-RuntimeIdString {
    param([int[]]$RuntimeId)
    if ($null -eq $RuntimeId -or $RuntimeId.Count -eq 0) { return "" }
    return (($RuntimeId | ForEach-Object { [string]$_ }) -join ".")
}

function Get-PatternActions {
    param([System.Windows.Automation.AutomationElement]$Element)
    $actions = New-Object System.Collections.Generic.List[string]

    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$patternObj)) {
        $actions.Add("invoke")
    }
    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObj)) {
        $actions.Add("setValue")
    }
    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$patternObj)) {
        $actions.Add("select")
    }
    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$patternObj)) {
        $actions.Add("expand")
        $actions.Add("collapse")
    }
    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$patternObj)) {
        $actions.Add("toggle")
    }
    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$patternObj)) {
        $actions.Add("scroll")
    }
    $patternObj = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$patternObj)) {
        if (-not $actions.Contains("scroll")) {
            $actions.Add("scroll")
        }
    }

    if (-not $actions.Contains("focus")) {
        $actions.Add("focus")
    }

    return $actions
}

function Get-VisibleRectInVirtualScreen {
    param(
        [System.Windows.Rect]$Rect,
        [hashtable]$ScreenInfo
    )

    if ($null -eq $ScreenInfo) { return $null }
    if ($ScreenInfo.width -le 0 -or $ScreenInfo.height -le 0) { return $null }
    if ($Rect.Width -le 0 -or $Rect.Height -le 0) { return $null }
    if ([double]::IsNaN($Rect.Left) -or [double]::IsNaN($Rect.Top)) { return $null }

    $left = [Math]::Max($Rect.Left, $ScreenInfo.left)
    $top = [Math]::Max($Rect.Top, $ScreenInfo.top)
    $right = [Math]::Min($Rect.Left + $Rect.Width, $ScreenInfo.left + $ScreenInfo.width)
    $bottom = [Math]::Min($Rect.Top + $Rect.Height, $ScreenInfo.top + $ScreenInfo.height)

    $width = $right - $left
    $height = $bottom - $top
    if ($width -le 0 -or $height -le 0) { return $null }

    return @{
        left = $left
        top = $top
        width = $width
        height = $height
        centerX = $left + ($width / 2.0)
        centerY = $top + ($height / 2.0)
    }
}

function Normalize-BoundingBox {
    param(
        [hashtable]$VisibleRect,
        [hashtable]$ScreenInfo
    )

    if ($null -eq $VisibleRect -or $null -eq $ScreenInfo) { return $null }
    if ($ScreenInfo.width -le 0 -or $ScreenInfo.height -le 0) { return $null }

    $x = ($VisibleRect.left - $ScreenInfo.left) / $ScreenInfo.width
    $y = ($VisibleRect.top - $ScreenInfo.top) / $ScreenInfo.height
    $w = $VisibleRect.width / $ScreenInfo.width
    $h = $VisibleRect.height / $ScreenInfo.height

    $x = [Math]::Max(0.0, [Math]::Min(1.0, $x))
    $y = [Math]::Max(0.0, [Math]::Min(1.0, $y))
    $w = [Math]::Max(0.0, [Math]::Min(1.0, $w))
    $h = [Math]::Max(0.0, [Math]::Min(1.0, $h))
    if ($w -le 0 -or $h -le 0) { return $null }

    return @{
        x = [Math]::Round($x, 6)
        y = [Math]::Round($y, 6)
        w = [Math]::Round($w, 6)
        h = [Math]::Round($h, 6)
    }
}

function Clamp-PointToVirtualScreen {
    param(
        [double]$X,
        [double]$Y
    )

    $screenInfo = Get-VirtualScreenInfo
    $minX = [int][Math]::Round($screenInfo.left)
    $minY = [int][Math]::Round($screenInfo.top)
    $maxX = [int][Math]::Round($screenInfo.left + $screenInfo.width - 1)
    $maxY = [int][Math]::Round($screenInfo.top + $screenInfo.height - 1)

    $clampedX = [Math]::Max($minX, [Math]::Min($maxX, [int][Math]::Round($X)))
    $clampedY = [Math]::Max($minY, [Math]::Min($maxY, [int][Math]::Round($Y)))

    return @{ x = $clampedX; y = $clampedY }
}

function Get-ForegroundProcessId {
    try {
        $hwnd = [Win32Native]::GetForegroundWindow()
        if ($hwnd -eq [IntPtr]::Zero) { return 0 }
        $pid = 0
        [Win32Native]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
        return [int]$pid
    } catch {
        return 0
    }
}

function Find-TargetProcess {
    param([string]$AppName)
    if ([string]::IsNullOrWhiteSpace($AppName)) { return $null }

    $normalized = Normalize-AppName $AppName
    $nameWithoutExe = $normalized
    if ($nameWithoutExe.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        $nameWithoutExe = $nameWithoutExe.Substring(0, $nameWithoutExe.Length - 4)
    }

    $all = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
    if ($null -eq $all) { return $null }

    $searchTerms = New-Object System.Collections.Generic.List[string]
    $searchTerms.Add($nameWithoutExe.ToLowerInvariant())
    $searchTerms.Add(([string]$AppName).ToLowerInvariant())
    if ($nameWithoutExe -eq "calculator" -or $nameWithoutExe -eq "calc") {
        $searchTerms.Add("calculator")
        $searchTerms.Add("calculatorapp")
        $searchTerms.Add("calculadora")
    }
    if ($nameWithoutExe -eq "notepad") {
        $searchTerms.Add("bloc")
    }

    $foregroundPid = Get-ForegroundProcessId
    $scored = foreach ($proc in $all) {
        $procName = $proc.ProcessName.ToLowerInvariant()
        $title = ([string]$proc.MainWindowTitle).ToLowerInvariant()

        $score = -1
        foreach ($term in $searchTerms) {
            if ([string]::IsNullOrWhiteSpace($term)) { continue }
            if ($procName -eq $term) {
                $score = [Math]::Max($score, 8)
            } elseif ($procName -like "*$term*") {
                $score = [Math]::Max($score, 6)
            } elseif ($title -like "*$term*") {
                $score = [Math]::Max($score, 5)
            }
        }

        if ($score -lt 0) { continue }
        if ($foregroundPid -gt 0 -and $proc.Id -eq $foregroundPid) {
            $score += 10
        }

        $startTime = [DateTime]::MinValue
        try { $startTime = $proc.StartTime } catch { $startTime = [DateTime]::MinValue }

        [PSCustomObject]@{
            Process = $proc
            Score = $score
            StartTime = $startTime
        }
    }

    $best = $scored |
        Sort-Object @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'StartTime'; Descending = $true } |
        Select-Object -First 1

    if ($best) { return $best.Process }
    return $null
}

function Get-ForegroundElement {
    $hwnd = [Win32Native]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    try {
        return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    } catch {
        return $null
    }
}

function Get-RootElementForApp {
    param([string]$AppName)
    if (-not [string]::IsNullOrWhiteSpace($AppName)) {
        $proc = Find-TargetProcess $AppName
        if ($proc -and $proc.MainWindowHandle -ne 0) {
            try {
                return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$proc.MainWindowHandle)
            } catch {
                # Fall back to foreground
            }
        }
    }
    return Get-ForegroundElement
}

function Collect-ElementsFromRoot {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [int]$MaxDepth = 7,
        [int]$MaxNodes = 900
    )

    $screenInfo = Get-VirtualScreenInfo
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($Root, 0))
    $elements = @()
    $idCounter = 1
    $seenRuntimeIds = New-Object 'System.Collections.Generic.HashSet[string]'

    while ($queue.Count -gt 0 -and $elements.Count -lt $MaxNodes) {
        $item = $queue.Dequeue()
        $element = [System.Windows.Automation.AutomationElement]$item[0]
        $depth = [int]$item[1]

        try {
            $rect = $element.Current.BoundingRectangle
            $isOffscreen = [bool]$element.Current.IsOffscreen
            if ($isOffscreen -and $depth -gt 0) {
                throw "OFFSCREEN"
            }

            $visibleRect = Get-VisibleRectInVirtualScreen -Rect $rect -ScreenInfo $screenInfo
            $bbox = Normalize-BoundingBox -VisibleRect $visibleRect -ScreenInfo $screenInfo
            if ($bbox -ne $null) {
                $actions = Get-PatternActions $element
                $typeName = Convert-ControlTypeName $element
                $label = Safe-Text $element.Current.Name
                $automationId = Safe-Text $element.Current.AutomationId
                $className = Safe-Text $element.Current.ClassName
                if ([string]::IsNullOrWhiteSpace($label)) {
                    $label = $automationId
                }
                if ([string]::IsNullOrWhiteSpace($label)) {
                    $label = $typeName
                }

                $runtimeIdStr = Convert-RuntimeIdString ($element.GetRuntimeId())
                if (-not [string]::IsNullOrWhiteSpace($runtimeIdStr) -and $seenRuntimeIds.Contains($runtimeIdStr)) {
                    throw "DUPLICATE_RUNTIME_ID"
                }
                if (-not [string]::IsNullOrWhiteSpace($runtimeIdStr)) {
                    $seenRuntimeIds.Add($runtimeIdStr) | Out-Null
                }
                $processId = $element.Current.ProcessId

                $valueText = $null
                $valuePatternObj = $null
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObj)) {
                    try {
                        $valueText = Safe-Text $valuePatternObj.Current.Value
                    } catch {
                        $valueText = $null
                    }
                }

                $semanticActions = @($actions | Where-Object { $_ -ne "focus" })
                $interactive = ($semanticActions.Count -gt 0) -or $element.Current.IsKeyboardFocusable -or ($typeName -match "Button|Edit|MenuItem|CheckBox|RadioButton|TabItem|ComboBox|ListItem|Hyperlink")
                $isEnabled = [bool]$element.Current.IsEnabled
                $includeAsStructure = ($depth -le 1) -and ($bbox.w -ge 0.015) -and ($bbox.h -ge 0.015)

                if (($interactive -or $includeAsStructure) -and -not $isOffscreen) {
                    $elements += [PSCustomObject]@{
                        id = $idCounter
                        type = $typeName
                        label = $label
                        bbox = $bbox
                        center = @{
                            x = [Math]::Round($visibleRect.centerX, 3)
                            y = [Math]::Round($visibleRect.centerY, 3)
                        }
                        actions = @($actions)
                        interactive = [bool]$interactive
                        nativeRef = @{
                            runtimeId = $runtimeIdStr
                            processId = $processId
                            controlType = $typeName
                            name = $label
                            automationId = $automationId
                            className = $className
                            bbox = $bbox
                        }
                        value = $valueText
                        state = @{
                            enabled = $isEnabled
                            offscreen = $isOffscreen
                            focused = [bool]$element.Current.HasKeyboardFocus
                        }
                    }
                    $idCounter++
                }
            }
        } catch {
            # Ignore inaccessible element
        }

        if ($depth -lt $MaxDepth) {
            $child = $null
            try { $child = $walker.GetFirstChild($element) } catch { $child = $null }
            while ($child -ne $null) {
                $queue.Enqueue(@($child, $depth + 1))
                try {
                    $child = $walker.GetNextSibling($child)
                } catch {
                    $child = $null
                }
            }
        }
    }

    return $elements
}

function Compare-IntArrays {
    param([int[]]$A, [int[]]$B)
    if ($null -eq $A -or $null -eq $B) { return $false }
    if ($A.Length -ne $B.Length) { return $false }
    for ($i = 0; $i -lt $A.Length; $i++) {
        if ($A[$i] -ne $B[$i]) { return $false }
    }
    return $true
}

function Find-ElementByRuntimeId {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$RuntimeId,
        [int]$MaxNodes = 3000
    )

    if ($null -eq $Root -or [string]::IsNullOrWhiteSpace($RuntimeId)) { return $null }

    $target = $RuntimeId.Split(".") | ForEach-Object { [int]$_ }
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($Root)
    $visited = 0

    while ($queue.Count -gt 0 -and $visited -lt $MaxNodes) {
        $visited++
        $current = [System.Windows.Automation.AutomationElement]$queue.Dequeue()
        try {
            $runtime = $current.GetRuntimeId()
            if (Compare-IntArrays -A $runtime -B $target) {
                return $current
            }
        } catch {
            # ignore
        }

        $child = $null
        try { $child = $walker.GetFirstChild($current) } catch { $child = $null }
        while ($child -ne $null) {
            $queue.Enqueue($child)
            try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
        }
    }

    return $null
}

function Normalize-LookupText {
    param($Value)
    if ($null -eq $Value) { return "" }
    return ([string]$Value).Trim().ToLowerInvariant()
}

function Find-ElementByProperties {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        $ElementRef,
        [int]$MaxNodes = 4000
    )

    if ($null -eq $Root -or $null -eq $ElementRef) { return $null }

    $targetProcessId = 0
    try { $targetProcessId = [int]$ElementRef.processId } catch { $targetProcessId = 0 }

    $targetAutomationId = Normalize-LookupText $ElementRef.automationId
    $targetName = Normalize-LookupText $ElementRef.name
    $targetType = Normalize-LookupText $ElementRef.controlType
    $targetClassName = Normalize-LookupText $ElementRef.className
    $targetBbox = $ElementRef.bbox
    $screenInfo = Get-VirtualScreenInfo

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($Root)
    $visited = 0
    $best = $null
    $bestScore = -1

    while ($queue.Count -gt 0 -and $visited -lt $MaxNodes) {
        $visited++
        $current = [System.Windows.Automation.AutomationElement]$queue.Dequeue()
        try {
            if ($targetProcessId -gt 0 -and $current.Current.ProcessId -ne $targetProcessId) {
                $child = $null
                try { $child = $walker.GetFirstChild($current) } catch { $child = $null }
                while ($child -ne $null) {
                    $queue.Enqueue($child)
                    try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
                }
                continue
            }

            $score = 0
            $curAutomationId = Normalize-LookupText $current.Current.AutomationId
            $curName = Normalize-LookupText $current.Current.Name
            $curClass = Normalize-LookupText $current.Current.ClassName
            $curType = Normalize-LookupText (Convert-ControlTypeName $current)

            if (-not [string]::IsNullOrWhiteSpace($targetAutomationId)) {
                if ($curAutomationId -eq $targetAutomationId) { $score += 8 }
                elseif ($curAutomationId -like "*$targetAutomationId*") { $score += 4 }
            }
            if (-not [string]::IsNullOrWhiteSpace($targetName)) {
                if ($curName -eq $targetName) { $score += 6 }
                elseif ($curName -like "*$targetName*" -or $targetName -like "*$curName*") { $score += 3 }
            }
            if (-not [string]::IsNullOrWhiteSpace($targetType) -and $curType -eq $targetType) {
                $score += 3
            }
            if (-not [string]::IsNullOrWhiteSpace($targetClassName) -and $curClass -eq $targetClassName) {
                $score += 2
            }

            if ($targetBbox -and $targetBbox.w -gt 0 -and $targetBbox.h -gt 0) {
                $curRect = $current.Current.BoundingRectangle
                $curVisibleRect = Get-VisibleRectInVirtualScreen -Rect $curRect -ScreenInfo $screenInfo
                $curBbox = Normalize-BoundingBox -VisibleRect $curVisibleRect -ScreenInfo $screenInfo
                if ($curBbox) {
                    $targetCx = [double]$targetBbox.x + ([double]$targetBbox.w / 2.0)
                    $targetCy = [double]$targetBbox.y + ([double]$targetBbox.h / 2.0)
                    $curCx = [double]$curBbox.x + ([double]$curBbox.w / 2.0)
                    $curCy = [double]$curBbox.y + ([double]$curBbox.h / 2.0)
                    $dist = [Math]::Sqrt([Math]::Pow($targetCx - $curCx, 2) + [Math]::Pow($targetCy - $curCy, 2))
                    if ($dist -lt 0.025) { $score += 6 }
                    elseif ($dist -lt 0.06) { $score += 4 }
                    elseif ($dist -lt 0.12) { $score += 2 }
                }
            }

            if ($score -gt $bestScore) {
                $bestScore = $score
                $best = $current
            }
        } catch {
            # ignore scoring errors
        }

        $child = $null
        try { $child = $walker.GetFirstChild($current) } catch { $child = $null }
        while ($child -ne $null) {
            $queue.Enqueue($child)
            try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
        }
    }

    if ($best -and $bestScore -ge 5) {
        return $best
    }
    return $null
}

function Resolve-ElementForAction {
    param($Params)
    $appName = $Params.appName
    $elementRef = $Params.element
    if ($null -eq $elementRef) { return $null }

    $root = Get-RootElementForApp $appName
    if ($null -eq $root) { return $null }

    $runtimeId = [string]$elementRef.runtimeId
    if (-not [string]::IsNullOrWhiteSpace($runtimeId)) {
        $byRuntime = Find-ElementByRuntimeId -Root $root -RuntimeId $runtimeId
        if ($byRuntime) { return $byRuntime }
    }

    return Find-ElementByProperties -Root $root -ElementRef $elementRef
}

function Do-PhysicalClick {
    param([System.Windows.Automation.AutomationElement]$Element)
    $screenInfo = Get-VirtualScreenInfo
    $x = 0
    $y = 0
    $hasPoint = $false

    try {
        $clickablePoint = $Element.GetClickablePoint()
        $x = [double]$clickablePoint.X
        $y = [double]$clickablePoint.Y
        $hasPoint = $true
    } catch {
        $hasPoint = $false
    }

    if (-not $hasPoint) {
        $rect = $Element.Current.BoundingRectangle
        $visibleRect = Get-VisibleRectInVirtualScreen -Rect $rect -ScreenInfo $screenInfo
        if ($null -eq $visibleRect) {
            throw "INVALID_BOUNDS"
        }
        $x = [double]$visibleRect.centerX
        $y = [double]$visibleRect.centerY
    }

    $point = Clamp-PointToVirtualScreen -X $x -Y $y

    try { $Element.SetFocus() } catch { }
    Start-Sleep -Milliseconds 25
    [Win32Native]::SetCursorPos($point.x, $point.y) | Out-Null
    Start-Sleep -Milliseconds 25
    [Win32Native]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # left down
    Start-Sleep -Milliseconds 30
    [Win32Native]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # left up
}

function Ensure-ElementReadyForAction {
    param([System.Windows.Automation.AutomationElement]$Element)
    if ($null -eq $Element) { return }

    if (-not [bool]$Element.Current.IsEnabled) {
        throw "ELEMENT_DISABLED"
    }

    if ([bool]$Element.Current.IsOffscreen) {
        $scrollItem = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scrollItem)) {
            try {
                $scrollItem.ScrollIntoView()
                Start-Sleep -Milliseconds 120
            } catch {
                throw "ELEMENT_OFFSCREEN"
            }
        } else {
            throw "ELEMENT_OFFSCREEN"
        }
    }
}

function Execute-ElementAction {
    param($Params)

    $element = Resolve-ElementForAction $Params
    if ($null -eq $element) {
        return @{ success = $false; error = "ELEMENT_NOT_FOUND" }
    }

    $action = [string]$Params.action
    if ([string]::IsNullOrWhiteSpace($action)) {
        $action = "invoke"
    } else {
        $action = $action.ToLowerInvariant()
    }
    $patternObj = $null

    try {
        Ensure-ElementReadyForAction $element

        switch ($action) {
            "focus" {
                $element.SetFocus()
                return @{ success = $true; action = "focus" }
            }
            "invoke" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Invoke()
                    return @{ success = $true; action = "invoke" }
                }
                if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Select()
                    return @{ success = $true; action = "select" }
                }
                if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Toggle()
                    return @{ success = $true; action = "toggle" }
                }
                Do-PhysicalClick $element
                return @{ success = $true; action = "click" }
            }
            "click" {
                Do-PhysicalClick $element
                return @{ success = $true; action = "click" }
            }
            "setvalue" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObj)) {
                    $value = [string]$Params.value
                    $patternObj.SetValue($value)
                    return @{ success = $true; action = "setValue" }
                }
                return @{ success = $false; error = "VALUE_PATTERN_NOT_SUPPORTED" }
            }
            "select" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Select()
                    return @{ success = $true; action = "select" }
                }
                return @{ success = $false; error = "SELECTION_PATTERN_NOT_SUPPORTED" }
            }
            "expand" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Expand()
                    return @{ success = $true; action = "expand" }
                }
                return @{ success = $false; error = "EXPAND_PATTERN_NOT_SUPPORTED" }
            }
            "collapse" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Collapse()
                    return @{ success = $true; action = "collapse" }
                }
                return @{ success = $false; error = "COLLAPSE_PATTERN_NOT_SUPPORTED" }
            }
            "toggle" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.Toggle()
                    return @{ success = $true; action = "toggle" }
                }
                return @{ success = $false; error = "TOGGLE_PATTERN_NOT_SUPPORTED" }
            }
            "scroll" {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$patternObj)) {
                    $direction = [string]$Params.direction
                    $amount = [string]$Params.amount
                    $verticalAmount = [System.Windows.Automation.ScrollAmount]::LargeIncrement
                    if ($amount -eq "small") { $verticalAmount = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
                    if ($amount -eq "medium") { $verticalAmount = [System.Windows.Automation.ScrollAmount]::LargeIncrement }
                    if ($direction -eq "up") {
                        if ($amount -eq "small") { $verticalAmount = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
                        else { $verticalAmount = [System.Windows.Automation.ScrollAmount]::LargeDecrement }
                    }
                    $patternObj.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, $verticalAmount)
                    return @{ success = $true; action = "scroll" }
                }
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$patternObj)) {
                    $patternObj.ScrollIntoView()
                    return @{ success = $true; action = "scrollIntoView" }
                }
                return @{ success = $false; error = "SCROLL_PATTERN_NOT_SUPPORTED" }
            }
            default {
                return @{ success = $false; error = "UNKNOWN_ACTION:$action" }
            }
        }
    } catch {
        return @{ success = $false; error = "ACTION_FAILED: $($_.Exception.Message)" }
    }
}

function Handle-OpenApp {
    param($Params)
    $appName = Normalize-AppName ([string]$Params.appName)
    if ([string]::IsNullOrWhiteSpace($appName)) {
        return @{ success = $false; error = "APP_NAME_REQUIRED" }
    }

    try {
        Start-Process -FilePath $appName | Out-Null
        return @{ success = $true; app = $appName }
    } catch {
        try {
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c start `"`" `"$appName`"" -WindowStyle Hidden | Out-Null
            return @{ success = $true; app = $appName }
        } catch {
            return @{ success = $false; error = "OPEN_APP_FAILED: $($_.Exception.Message)" }
        }
    }
}

function Handle-FocusApp {
    param($Params)
    $appName = [string]$Params.appName
    $proc = Find-TargetProcess $appName
    if ($null -eq $proc) {
        return @{ success = $false; error = "APP_NOT_FOUND" }
    }
    if ($proc.MainWindowHandle -eq 0) {
        return @{ success = $false; error = "APP_WINDOW_NOT_FOUND" }
    }

    $hwnd = [IntPtr]$proc.MainWindowHandle
    if ([Win32Native]::IsIconic($hwnd)) {
        [Win32Native]::ShowWindow($hwnd, 9) | Out-Null # SW_RESTORE
    }
    [Win32Native]::SetForegroundWindow($hwnd) | Out-Null
    return @{ success = $true; app = $proc.ProcessName; pid = $proc.Id }
}

function Handle-Extract {
    param($Params)
    $appName = [string]$Params.appName
    $root = Get-RootElementForApp $appName
    if ($null -eq $root) {
        return @{ error = "NO_ACTIVE_WINDOW"; diagnostic = "NO_WINDOW"; snapshot = @() }
    }

    $elements = Collect-ElementsFromRoot -Root $root
    $processName = ""
    try {
        $proc = Get-Process -Id $root.Current.ProcessId -ErrorAction SilentlyContinue
        if ($proc) { $processName = $proc.ProcessName }
    } catch {
        $processName = ""
    }

    return @{
        app = (Safe-Text $processName)
        window = (Safe-Text $root.Current.Name)
        snapshot = $elements
        source = "UIA_WINDOWS"
    }
}

function Handle-Request {
    param($Request)
    $method = [string]$Request.method
    $params = $Request.params

    switch ($method) {
        "ping" {
            return @{ ok = $true; result = @{ pong = $true } }
        }
        "extract" {
            $result = Handle-Extract $params
            return @{ ok = $true; result = $result }
        }
        "openApp" {
            $result = Handle-OpenApp $params
            if ($result.success) { return @{ ok = $true; result = $result } }
            return @{ ok = $false; error = $result.error }
        }
        "focusApp" {
            $result = Handle-FocusApp $params
            if ($result.success) { return @{ ok = $true; result = $result } }
            return @{ ok = $false; error = $result.error }
        }
        "performAction" {
            $result = Execute-ElementAction $params
            if ($result.success) { return @{ ok = $true; result = $result } }
            return @{ ok = $false; error = $result.error }
        }
        "shutdown" {
            return @{ ok = $true; result = @{ stopping = $true } }
        }
        default {
            return @{ ok = $false; error = "UNKNOWN_METHOD:$method" }
        }
    }
}

try {
    $isOneShot = -not [string]::IsNullOrWhiteSpace($RequestJson)
    if ($isOneShot) {
        $response = $null
        try {
            $request = $RequestJson | ConvertFrom-Json
            $responseCore = Handle-Request $request
            $response = @{
                id = $request.id
                ok = [bool]$responseCore.ok
                result = $responseCore.result
                error = $responseCore.error
            }
        } catch {
            $response = @{
                id = $null
                ok = $false
                result = $null
                error = "INTERNAL_ERROR: $($_.Exception.Message)"
            }
        }

        [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 20))
        return
    }

    Write-HostLog "Starting companion (stdio IPC)"
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        $request = $null
        try {
            $request = $line | ConvertFrom-Json
        } catch {
            continue
        }

        $responseCore = $null
        try {
            $responseCore = Handle-Request $request
        } catch {
            $responseCore = @{ ok = $false; error = "INTERNAL_ERROR: $($_.Exception.Message)" }
        }

        $response = @{
            id = $request.id
            ok = [bool]$responseCore.ok
            result = $responseCore.result
            error = $responseCore.error
        }

        [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 20))

        if ($request.method -eq "shutdown") {
            break
        }
    }
} catch {
    Write-HostLog "Fatal companion error: $($_.Exception.Message)"
} finally {
    if ([string]::IsNullOrWhiteSpace($RequestJson)) {
        Write-HostLog "Companion stopped"
    }
}
