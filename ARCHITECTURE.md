# Drifting Sagan - Architecture

## Core Philosophy
**"An app that knows nothing but can understand everything."**

The architecture is divided into two distinct parts:
1.  **Ü (The Face)**: The visual, living interface that interacts with the user.
2.  **The Functional Trunk**: A generic cognitive engine that navigates external applications using a cycle of Formalization, Reasoning (HRM), and Execution.

## Directory Structure

```
src/
├── core/           # The Functional Trunk (Generic Cognitive Engine)
│   ├── formalizer/ # Turns DOM/UI into abstract graphs
│   ├── hrm/        # Hierarchical Recursive Memory (Navigation/Reasoning)
│   └── execution/  # Executes actions on the target UI
├── face/           # The Living Interface (SVG Animation, GSAP)
├── systems/        # Platform integrations (Audio, Vision, etc.)
└── legacy/         # Deprecated demos (e.g., Medical Demo)
```

## The Functional Trunk Flow

The core logic operates in a continuous loop:

1.  **Formalization** (`src/core/formalizer`)
    - **Input**: Raw UI State (DOM, Screenshot, accessibility tree).
    - **Process**: Normalizes data, identifying interactive elements and stability.
    - **Output**: A `UINode` (Graph Node) representing the current state.

2.  **HRM Reasoning** (`src/core/hrm`)
    - **Input**: Current `UINode` and Target Goal.
    - **Process**: Converts the graph into a 2D Grid (amenable to spatial reasoning models) and finds the optimal path.
    - **Output**: A sequence of abstract steps (e.g., "State A -> State B -> State C").

3.  **Execution** (`src/core/execution`)
    - **Input**: Abstract steps + Current Page Context.
    - **Process**: Translates abstract steps into concrete actions (Click `#btn`, Type "Hello").
    - **Output**: Physical interaction with the browser/app.

## The Interface (Ü)

Located in `src/face/`, this is the user-facing personality.
- **Parametric Design**: SVG-based face controlled by math.
- **State Machine**: Happiness, Attention, Thinking, etc.
- **Events**: Reacts to system events (e.g., "Thinking" expression while the Core is processing).

## Development Guidelines

- **Keep it Generic**: The `core` should never contain app-specific logic (like "Patient ID" or "Login Button"). It must work on *patterns* (inputs, buttons, flows).
- **Separation of Concerns**: The Face doesn't know *how* the Core solves problems, only *that* it is solving them.
- **Legacy Code**: Do not modify `src/legacy`. If you need something from it, extract it to `src/core` and make it generic.
