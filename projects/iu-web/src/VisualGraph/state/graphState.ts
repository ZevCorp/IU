// VisualGraph State Management
// Manages graph data, camera modes, focus state, and dual world system

export type WorldMode = 'creator' | 'code';

export interface GraphNode {
    id: string;
    label: string;
    type: 'expression';
    creatorPosition?: [number, number, number];
    codePosition?: [number, number, number];
    isUserCreated?: boolean;
}

export interface GraphEdge {
    from: string;
    to: string;
    weight?: number;
}

export type CameraMode = 'exploration' | 'transaction' | 'decision';

export interface GraphState {
    nodes: GraphNode[];
    edges: GraphEdge[];
    focusedNodeId: string | null;
    compareNodeIds: [string, string] | null;
    cameraMode: CameraMode;
    confirmedNodeId: string | null;
    worldMode: WorldMode;
}

// Initial simulated expression nodes
const INITIAL_NODES: GraphNode[] = [
    { id: 'attention', label: 'Attention', type: 'expression' },
    { id: 'confusion', label: 'Confusion', type: 'expression' },
    { id: 'confirmation', label: 'Confirmation', type: 'expression' },
    { id: 'curiosity', label: 'Curiosity', type: 'expression' },
    { id: 'surprise', label: 'Surprise', type: 'expression' },
    { id: 'neutral', label: 'Neutral', type: 'expression' },
    { id: 'focus', label: 'Focus', type: 'expression' },
    { id: 'recognition', label: 'Recognition', type: 'expression' },
];

// Semantic connections between expressions
const INITIAL_EDGES: GraphEdge[] = [
    { from: 'neutral', to: 'attention', weight: 0.8 },
    { from: 'attention', to: 'focus', weight: 0.9 },
    { from: 'attention', to: 'curiosity', weight: 0.7 },
    { from: 'curiosity', to: 'confusion', weight: 0.5 },
    { from: 'curiosity', to: 'recognition', weight: 0.6 },
    { from: 'focus', to: 'confirmation', weight: 0.8 },
    { from: 'recognition', to: 'confirmation', weight: 0.7 },
    { from: 'neutral', to: 'surprise', weight: 0.4 },
    { from: 'surprise', to: 'curiosity', weight: 0.6 },
    { from: 'confusion', to: 'neutral', weight: 0.3 },
];

// Create initial state
export function createInitialState(): GraphState {
    return {
        nodes: INITIAL_NODES,
        edges: INITIAL_EDGES,
        focusedNodeId: null,
        compareNodeIds: null,
        cameraMode: 'exploration',
        confirmedNodeId: null,
        worldMode: 'code',
    };
}

// State management class for reactive updates
export class GraphStateManager {
    private state: GraphState;
    private listeners: Set<(state: GraphState) => void>;

    constructor() {
        this.state = createInitialState();
        this.listeners = new Set();
    }

    getState(): GraphState {
        return this.state;
    }

    subscribe(listener: (state: GraphState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        this.listeners.forEach(listener => listener(this.state));
    }

    setFocusedNode(nodeId: string | null): void {
        this.state = {
            ...this.state,
            focusedNodeId: nodeId,
            compareNodeIds: null,
            cameraMode: nodeId ? 'transaction' : 'exploration',
            confirmedNodeId: null,
        };
        this.notify();
    }

    setCompareNodes(nodeIdA: string, nodeIdB: string): void {
        this.state = {
            ...this.state,
            focusedNodeId: null,
            compareNodeIds: [nodeIdA, nodeIdB],
            cameraMode: 'decision',
            confirmedNodeId: null,
        };
        this.notify();
    }

    confirmNode(nodeId: string): void {
        this.state = {
            ...this.state,
            confirmedNodeId: nodeId,
        };
        this.notify();
    }

    returnToContext(): void {
        this.state = {
            ...this.state,
            focusedNodeId: null,
            compareNodeIds: null,
            cameraMode: 'exploration',
            confirmedNodeId: null,
        };
        this.notify();
    }

    updateNodePositions(positions: Map<string, [number, number, number]>, world: WorldMode): void {
        this.state = {
            ...this.state,
            nodes: this.state.nodes.map(node => ({
                ...node,
                [world === 'creator' ? 'creatorPosition' : 'codePosition']:
                    positions.get(node.id) || (world === 'creator' ? node.creatorPosition : node.codePosition),
            })),
        };
        this.notify();
    }

    toggleWorldMode(): void {
        this.state = {
            ...this.state,
            worldMode: this.state.worldMode === 'code' ? 'creator' : 'code',
            focusedNodeId: null,
            compareNodeIds: null,
            cameraMode: 'exploration',
            confirmedNodeId: null,
        };
        this.notify();
    }

    createNode(label: string, creatorPosition: [number, number, number]): string {
        const id = `node_${Date.now()}`;
        const newNode: GraphNode = {
            id,
            label,
            type: 'expression',
            creatorPosition,
            codePosition: undefined,
            isUserCreated: true,
        };
        this.state = {
            ...this.state,
            nodes: [...this.state.nodes, newNode],
        };
        this.notify();
        return id;
    }

    addEdge(from: string, to: string, weight: number = 0.5): void {
        const newEdge: GraphEdge = { from, to, weight };
        this.state = {
            ...this.state,
            edges: [...this.state.edges, newEdge],
        };
        this.notify();
    }

    deleteNode(nodeId: string): void {
        this.state = {
            ...this.state,
            nodes: this.state.nodes.filter(n => n.id !== nodeId),
            edges: this.state.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
            focusedNodeId: this.state.focusedNodeId === nodeId ? null : this.state.focusedNodeId,
        };
        this.notify();
    }

    updateNodePosition(nodeId: string, position: [number, number, number], world: WorldMode): void {
        this.state = {
            ...this.state,
            nodes: this.state.nodes.map(node => {
                if (node.id === nodeId) {
                    return {
                        ...node,
                        [world === 'creator' ? 'creatorPosition' : 'codePosition']: position,
                    };
                }
                return node;
            }),
        };
        this.notify();
    }
}

// Singleton instance
export const graphStateManager = new GraphStateManager();
