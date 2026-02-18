# 🏗️ IU-OS Architecture

## 📊 System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            IU-OS SYSTEM                                  │
│                     (Electron Desktop Application)                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
            ┌───────▼────────┐             ┌────────▼────────┐
            │  Main Process  │             │  Renderer UI    │
            │   (main.js)    │◄────IPC────►│   (app.js)      │
            └───────┬────────┘             └─────────────────┘
                    │
        ┌───────────┼───────────┬──────────────┬──────────────┐
        │           │           │              │              │
   ┌────▼────┐ ┌───▼────┐ ┌────▼─────┐  ┌────▼─────┐  ┌─────▼──────┐
   │ Model   │ │ Action │ │  Screen  │  │ ChatGPT  │  │   Voice    │
   │ Switch  │ │ Planner│ │  Agent   │  │Playwright│  │  Sensors   │
   └────┬────┘ └───┬────┘ └────┬─────┘  └────┬─────┘  └────────────┘
        │          │           │              │
        │          │           │              │
   ┌────▼──────────▼───────────▼──────────────▼─────┐
   │           AI MODEL PROVIDERS                    │
   │  • OpenAI API (gpt-5-nano/mini/5.2)            │
   │  • Google Gemini (gemini-2.5-flash)            │
   │  • Anthropic Claude (claude-3-5-haiku)         │
   │  • ChatGPT Web (chat.openai.com via Playwright)│
   └─────────────────────────────────────────────────┘
```

---

## 🧩 Core Components

### 1️⃣ **ModelSwitch.js** - AI Model Router
**Purpose**: Unified interface for switching between OpenAI and Gemini

```javascript
// Configuration
BRAIN_PROVIDER: "openai" | "gemini" | "anthropic"
BRAIN_MODEL: "nano" | "mini" | "full" | "haiku"

// OpenAI Models
nano → gpt-5-nano      (fastest, cheapest)
mini → gpt-5-mini      (balanced)
full → gpt-5.2         (most capable)

// Gemini Models
chat/vision → gemini-2.5-flash

// Anthropic Models
chat/vision → claude-3-5-haiku-20241022
```

**Functions**:
- `chatCompletion()` - Text-only with function calling
- `visionCompletion()` - Multimodal (image + text)

**Used by**: ActionPlanner, ScreenAgent, AxExtractionAgent, Chat Window

---

### 2️⃣ **ActionPlanner.js** - Intent → Action Converter
**Purpose**: Converts user speech into executable screen actions

```
User Speech → ActionPlanner → execute_screen_action()
                    ↓
        { goal, app, stepsHint }
```

**Modes**:
- **Explicit**: User directly asks for action ("Send message to María")
- **Implicit**: User confirms ambient suggestion (nod detection)

**Model**: Uses `ModelSwitch.chatCompletion()` with function calling

---

### 3️⃣ **ScreenAgent.js** - Screen Automation Engine
**Purpose**: Executes actions on macOS using AX Accessibility + Vision

```
┌─────────────────────────────────────────────────┐
│              ScreenAgent Flow                    │
└─────────────────────────────────────────────────┘
         │
    1. Detect UI Elements
         │
    ┌────▼─────┐
    │ AX Tree  │ (SimpleAxAgent via JXA)
    │ or Vision│ (Screenshot + GPT-5-mini)
    └────┬─────┘
         │
    2. Send to LLM
         │
    ┌────▼─────────────────────────────┐
    │ ModelSwitch.chatCompletion()     │
    │ Tools: click, type, scroll, etc. │
    └────┬─────────────────────────────┘
         │
    3. Execute Action
         │
    ┌────▼─────┐
    │ nut-js   │ (mouse/keyboard control)
    └──────────┘
```

**Detection Methods**:
- **Primary**: AX Accessibility (fast, deterministic)
- **Fallback**: Vision (screenshot analysis with GPT-5-mini)

**Max Iterations**: 15 steps per goal

---

### 4️⃣ **AxExtractionAgent.js.future** - Smart AX Extractor
**Purpose**: Intelligent AX tree extraction with self-healing

```
┌──────────────────────────────────────────────────┐
│        AxExtractionAgent Pipeline                │
└──────────────────────────────────────────────────┘
         │
    1. Try Extract (JXA)
         │
    ┌────▼─────┐
    │ Success? │──Yes──► Return Elements
    └────┬─────┘
         │ No
    2. Diagnose with GPT-5-mini
         │
    ┌────▼──────────────────────────┐
    │ LLM analyzes error            │
    │ Tools: search_web,            │
    │        recommend_solution     │
    └────┬──────────────────────────┘
         │
    3. Execute Fix
         │
    ┌────▼─────────────────┐
    │ • focus_app          │
    │ • open_app           │
    │ • wait               │
    └────┬─────────────────┘
         │
    4. Retry (max 5 attempts)
         │
         └──► Loop back to step 1
```

**Web Search**: Uses ChatGPT+Playwright for research

---

### 5️⃣ **ChatGPT + Playwright Integration**
**Purpose**: Voice conversation and web search via chat.openai.com

```
┌────────────────────────────────────────────────────┐
│         ChatGPT Playwright Architecture            │
└────────────────────────────────────────────────────┘

1. Browser Setup
   ┌──────────────────────────────────┐
   │ chromium.launchPersistentContext │
   │ • Saves login state              │
   │ • Microphone permissions         │
   │ • Stealth mode (hide automation) │
   └──────────────────────────────────┘

2. System Prompt Injection
   ┌──────────────────────────────────┐
   │ On startup:                      │
   │ • Fill #prompt-textarea          │
   │ • Click send button              │
   │ • Wait for response              │
   └──────────────────────────────────┘

3. Voice Control
   ┌──────────────────────────────────────────┐
   │ Start: button[data-testid=               │
   │        "composer-speech-button"]         │
   │ Stop:  button[aria-label="End Voice"]    │
   └──────────────────────────────────────────┘

4. Real-time Monitoring
   ┌──────────────────────────────────────────┐
   │ setInterval(() => {                      │
   │   Extract user transcription from DOM    │
   │   [data-message-author-role="user"]      │
   │   → Send to ActionPlanner                │
   │ })                                       │
   └──────────────────────────────────────────┘

5. Web Search (for AxExtractionAgent)
   ┌──────────────────────────────────────────┐
   │ chatPage.locator('#prompt-textarea')     │
   │   .fill('Search the web: ...')           │
   │ → Wait 10s for response                  │
   │ → Extract from .markdown element         │
   └──────────────────────────────────────────┘
```

**Key Features**:
- ✅ Persistent session (login saved)
- ✅ Voice mode with microphone
- ✅ Real-time transcription monitoring
- ✅ Web search capability
- ✅ **Remains intact** - no modifications needed

---

## 🔄 Data Flow Examples

### Example 1: User Says "Send message to María"

```
1. User speaks
   └─► Voice captured by ChatGPT Playwright

2. Transcription extracted
   └─► main.js monitors DOM for user message

3. ActionPlanner.planFromExplicit()
   └─► ModelSwitch.chatCompletion()
       └─► GPT-5-mini with function calling
           └─► Returns: { goal, app: "WhatsApp", stepsHint }

4. User confirms action
   └─► ScreenAgent.run(goal)

5. ScreenAgent detects UI
   └─► AX Accessibility extracts WhatsApp elements
       └─► [Contact List, Search Box, Message Input, etc.]

6. ScreenAgent decides action
   └─► ModelSwitch.chatCompletion()
       └─► GPT-5-mini: "Click search box, type 'María'"

7. Execute with nut-js
   └─► mouse.click(x, y)
   └─► keyboard.type("María")

8. Repeat until goal complete
   └─► Max 15 iterations
```

---

### Example 2: AX Extraction Fails

```
1. ScreenAgent tries AX detection
   └─► ax-reader.js (JXA) fails

2. AxExtractionAgent.extract()
   └─► Attempt 1: Error "No window found"

3. Diagnose with GPT-5-mini
   └─► ModelSwitch.chatCompletion()
       └─► LLM: "App not focused"
       └─► Tool call: recommend_solution
           └─► actions: [{ type: "focus_app", appName: "Calculator" }]

4. Execute fix
   └─► osascript -e 'tell application "Calculator" to activate'

5. Retry extraction
   └─► Attempt 2: Success! ✅
```

---

## 🎯 AI Model Usage Summary

| Component | Model Used | Purpose |
|-----------|-----------|---------|
| **ActionPlanner** | `gpt-5-mini` | Convert speech → action plan |
| **ScreenAgent** | `gpt-5-mini` | Decide UI actions (click/type) |
| **AxExtractionAgent** | `gpt-5-mini` | Diagnose AX failures |
| **Chat Window** | `gpt-5-mini` | Direct user conversation |
| **ChatGPT Playwright** | `chatgpt.com` | Voice conversation + web search |

**Configuration**:
```bash
# .env file
BRAIN_PROVIDER=openai          # or "gemini", "anthropic"
BRAIN_MODEL=mini               # nano | mini | full | haiku
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...              # optional for Gemini
ANTHROPIC_API_KEY=...           # optional for Anthropic
```

---

## 🔧 Key Files

```
iu-os/
├── main.js                      # Main process, IPC handlers
├── ModelSwitch.js               # AI model router ⭐
├── ActionPlanner.js             # Speech → action converter ⭐
├── ScreenAgent.js               # Screen automation engine ⭐
├── AxExtractionAgent.js.future  # Smart AX extractor ⭐
├── SimpleAxAgent.js             # Basic AX reader (deterministic)
├── ax-reader.js                 # JXA script for AX tree
├── renderer/
│   └── app.js                   # UI logic, vision sensors
└── package.json
```

---

## 🚀 Startup Sequence

```
1. Electron app.ready
   └─► Initialize OpenAI client
   └─► Initialize ModelSwitch (OpenAI + Gemini)
   └─► Create ActionPlanner
   └─► Create ScreenAgent

2. Create main window (sidebar)
   └─► Load renderer/app.js

3. Setup ChatGPT Playwright
   └─► Launch persistent browser context
   └─► Navigate to chatgpt.com
   └─► Inject system prompt
   └─► Start voice monitoring

4. Ready for user interaction ✅
```

---

## 📝 Notes

- **ChatGPT Playwright** is independent and remains **fully intact**
- **ModelSwitch** centralizes all OpenAI API calls
- **Default model**: `gpt-5-nano` (fastest, cheapest)
- **Recommended**: `gpt-5-mini` (best balance)
- **Premium**: `gpt-5.2` (most capable, expensive)
