// CinematicGraph - Main Component
// Integrates all VisualGraph systems with dual world support (Creator/Code)

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from './scene/Environment';
import { CameraRig } from './scene/CameraRig';
import { Graph3D } from './scene/Graph3D';
import { CreatorPortal } from './scene/CreatorPortal';
import { semanticLayout } from './layout/semanticLayout';
import {
    GraphState,
    graphStateManager,
} from './state/graphState';
import {
    interactionController,
} from './interaction/interactionController';
import { createPerceptionPipeline, type PerceptionPipeline, type ActiveGraphState } from '../perception';

interface CinematicGraphProps {
    width?: string | number;
    height?: string | number;
    onNodeFocus?: (nodeId: string) => void;
    onNodeConfirm?: (nodeId: string) => void;
    onWorldChange?: (world: 'creator' | 'code') => void;
    onNodeCreate?: (nodeId: string, label: string) => void;
}

export function CinematicGraph({
    width = '100%',
    height = '100vh',
    onNodeFocus,
    onNodeConfirm,
    onWorldChange,
    onNodeCreate,
}: CinematicGraphProps): React.ReactElement {
    // Use graphStateManager as single source of truth
    const [state, setState] = useState<GraphState>(() => graphStateManager.getState());
    const [nodeCounter, setNodeCounter] = useState(1);
    const [connectionModeNodeId, setConnectionModeNodeId] = useState<string | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);

    // Facial state perception (edge-constrained)
    const [facialStatePosition, setFacialStatePosition] = useState<[number, number, number] | null>(null);
    const [activeEdge, setActiveEdge] = useState<ActiveGraphState | null>(null);
    const perceptionRef = useRef<PerceptionPipeline | null>(null);

    // Recalculate positions when nodes change
    const positions = useMemo(() => {
        const creatorPositions = semanticLayout(state.nodes, state.edges, { radius: 3 });
        const codePositions = semanticLayout(state.nodes, state.edges, { radius: 5 });
        return state.worldMode === 'creator' ? creatorPositions : codePositions;
    }, [state.nodes, state.edges, state.worldMode]);

    // Get creator positions for portal
    const creatorPositions = useMemo(() => {
        return semanticLayout(state.nodes, state.edges, { radius: 3 });
    }, [state.nodes, state.edges]);

    // Subscribe to state changes
    useEffect(() => {
        const unsubscribe = graphStateManager.subscribe(setState);
        return unsubscribe;
    }, []);

    // Initialize perception pipeline with edge-constrained navigation
    useEffect(() => {
        const pipeline = createPerceptionPipeline();
        perceptionRef.current = pipeline;

        // Set graph data (edges + positions)
        pipeline.setGraphData(state.edges, positions);

        // Subscribe to state updates
        const unsubscribe = pipeline.onStateChange((_, projected) => {
            setFacialStatePosition(projected.position);
            setActiveEdge(projected.activeEdge);
        });

        // Start the perception pipeline
        pipeline.start().catch(err => {
            console.warn('[CinematicGraph] Camera access denied:', err.message);
        });

        return () => {
            unsubscribe();
            pipeline.stop();
        };
    }, []); // Only initialize once

    // Update perception with latest graph data when it changes
    useEffect(() => {
        if (perceptionRef.current) {
            perceptionRef.current.setGraphData(state.edges, positions);
        }
    }, [state.edges, positions]);

    // Setup keyboard controls
    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            const currentState = graphStateManager.getState();

            switch (event.key) {
                case 'Escape':
                    interactionController.returnToContext();
                    setConnectionModeNodeId(null);
                    break;
                case 'Enter':
                    if (currentState.focusedNodeId) {
                        interactionController.confirm(currentState.focusedNodeId);
                    }
                    break;
                case 'Tab':
                    event.preventDefault();
                    graphStateManager.toggleWorldMode();
                    const newState = graphStateManager.getState();
                    onWorldChange?.(newState.worldMode);
                    setConnectionModeNodeId(null);
                    break;
                case 'n':
                case 'N':
                    // Only create nodes in Creator world
                    if (currentState.worldMode === 'creator') {
                        const label = `Node ${nodeCounter}`;
                        const pos: [number, number, number] = [
                            (Math.random() - 0.5) * 4,
                            (Math.random() - 0.5) * 2,
                            (Math.random() - 0.5) * 4,
                        ];
                        const newId = graphStateManager.createNode(label, pos);
                        setNodeCounter(c => c + 1);
                        onNodeCreate?.(newId, label);
                    }
                    break;
                case 'Delete':
                case 'Backspace':
                    // Delete focused node
                    if (currentState.focusedNodeId) {
                        graphStateManager.deleteNode(currentState.focusedNodeId);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [onWorldChange, onNodeCreate, nodeCounter]);

    // Setup callbacks
    useEffect(() => {
        interactionController.setCallbacks({
            onFocus: onNodeFocus,
            onConfirm: onNodeConfirm,
        });
    }, [onNodeFocus, onNodeConfirm]);

    // Handle node click (with Shift for connection mode)
    const handleNodeClick = useCallback((nodeId: string, shiftKey?: boolean) => {
        const currentState = graphStateManager.getState();
        const node = currentState.nodes.find(n => n.id === nodeId);

        // Connection mode: Shift + click two user-created nodes in Creator world
        if (shiftKey && currentState.worldMode === 'creator' && node?.isUserCreated) {
            if (!connectionModeNodeId) {
                // Start connection mode
                setConnectionModeNodeId(nodeId);
            } else if (connectionModeNodeId !== nodeId) {
                // Complete connection
                graphStateManager.addEdge(connectionModeNodeId, nodeId);
                setConnectionModeNodeId(null);
            } else {
                // Cancel connection if clicking same node
                setConnectionModeNodeId(null);
            }
            return;
        }

        // Normal click behavior
        if (currentState.cameraMode === 'exploration') {
            interactionController.focus(nodeId);
        } else if (currentState.cameraMode === 'transaction') {
            if (currentState.focusedNodeId === nodeId) {
                interactionController.confirm(nodeId);
            } else {
                interactionController.compare(currentState.focusedNodeId!, nodeId);
            }
        } else if (currentState.cameraMode === 'decision') {
            interactionController.confirm(nodeId);
        }
    }, [connectionModeNodeId]);

    // Handle node drag
    const handleNodeDrag = useCallback((nodeId: string, position: [number, number, number]) => {
        graphStateManager.updateNodePosition(nodeId, position, state.worldMode);
    }, [state.worldMode]);

    // Get camera target positions
    const targetPosition = useMemo(() => {
        if (state.focusedNodeId) {
            return positions.get(state.focusedNodeId);
        }
        return undefined;
    }, [state.focusedNodeId, positions]);

    const comparePositions = useMemo(() => {
        if (state.compareNodeIds) {
            const posA = positions.get(state.compareNodeIds[0]);
            const posB = positions.get(state.compareNodeIds[1]);
            if (posA && posB) {
                return [posA, posB] as [[number, number, number], [number, number, number]];
            }
        }
        return undefined;
    }, [state.compareNodeIds, positions]);

    const isCreator = state.worldMode === 'creator';
    const bgColor = isCreator ? '#f5f5f5' : '#1a1a1a';
    const textColor = isCreator ? '#374151' : '#6b7280';

    return (
        <div
            style={{ width, height, background: bgColor }}
            onKeyDown={(e) => {
                // Pass shift key state to clicks
                if (e.key === 'Shift') {
                    // Shift key is being held
                }
            }}
        >
            <Canvas
                camera={{
                    position: [0, 3, 12],
                    fov: 45,
                    near: 0.1,
                    far: 100,
                }}
                dpr={[1, 2]}
            >
                <Environment worldMode={state.worldMode} />

                <CameraRig
                    mode={state.cameraMode}
                    targetPosition={targetPosition}
                    comparePositions={comparePositions}
                    isDragActive={isDragActive}
                />

                <Graph3D
                    nodes={state.nodes}
                    edges={state.edges}
                    positions={positions}
                    focusedNodeId={state.focusedNodeId}
                    compareNodeIds={state.compareNodeIds}
                    confirmedNodeId={state.confirmedNodeId}
                    onNodeClick={handleNodeClick}
                    worldMode={state.worldMode}
                    onNodeDrag={handleNodeDrag}
                    connectionModeNodeId={connectionModeNodeId}
                    onDragStart={() => setIsDragActive(true)}
                    onDragEnd={() => setIsDragActive(false)}
                    facialStatePosition={facialStatePosition ?? undefined}
                    activeEdge={activeEdge ?? undefined}
                />

                {/* Show Creator Portal only in Code world */}
                {!isCreator && (
                    <CreatorPortal
                        nodes={state.nodes}
                        edges={state.edges}
                        creatorPositions={creatorPositions}
                        position={[0, 0, -10]}
                        radius={2.5}
                    />
                )}
            </Canvas>

            {/* Minimal UI hint */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 20,
                    left: 20,
                    color: textColor,
                    fontSize: 12,
                    fontFamily: 'system-ui, sans-serif',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                }}
            >
                {state.worldMode} world • {state.cameraMode}
                {state.cameraMode !== 'exploration' && ' • ESC'}
                {isCreator && ' • N=create'}
                {isCreator && ' • DRAG=move • SHIFT+CLICK=connect'}
                {connectionModeNodeId && ' • SHIFT+CLICK 2nd node'}
                {state.focusedNodeId && ' • DEL=delete'}
                {' • TAB=switch'}
            </div>
        </div>
    );
}

// Re-export
export { interactionController } from './interaction/interactionController';
export { graphStateManager } from './state/graphState';
export type { GraphNode, GraphEdge, GraphState, CameraMode, WorldMode } from './state/graphState';
