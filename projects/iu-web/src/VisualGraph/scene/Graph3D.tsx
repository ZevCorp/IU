// Graph3D Component
// Renders nodes and edges in 3D space with interactive focus and dragging

import React, { useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Text, Line } from '@react-three/drei';
import { Mesh, Vector3 } from 'three';
import type { GraphNode, GraphEdge, WorldMode } from '../state/graphState';
import { dragState } from '../state/dragState';
import { FacialStateMarker } from './FacialStateMarker';
import type { ActiveGraphState } from '../../perception';

interface NodeMeshProps {
    node: GraphNode;
    position: [number, number, number];
    isFocused: boolean;
    isComparing: boolean;
    isConfirmed: boolean;
    onClick: (shiftKey: boolean) => void;
    isCreatorWorld: boolean;
    isDraggable: boolean;
    onDrag?: (position: [number, number, number]) => void;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    isConnectionMode: boolean;
    isConnectionCandidate: boolean;
}

function NodeMesh({
    node,
    position,
    isFocused,
    isComparing,
    isConfirmed,
    onClick,
    isCreatorWorld,
    isDraggable,
    onDrag,
    onDragStart,
    onDragEnd,
    isConnectionMode,
    isConnectionCandidate,
}: NodeMeshProps): React.ReactElement {
    const meshRef = useRef<Mesh>(null);
    const targetScale = useRef(1);
    const targetEmission = useRef(0);
    const [isDragging, setIsDragging] = useState(false);

    // Determine visual state - different palettes for each world
    const baseColor = useMemo(() => {
        if (isConnectionCandidate) return '#a78bfa'; // Purple for connection candidate
        if (isConfirmed) return '#4ade80'; // Green for confirmed
        if (isFocused) return '#60a5fa'; // Blue for focused
        if (isComparing) return '#f59e0b'; // Amber for comparing
        // Default: darker for creator (light bg), lighter for code (dark bg)
        return isCreatorWorld ? '#374151' : '#6b7280';
    }, [isFocused, isComparing, isConfirmed, isCreatorWorld, isConnectionCandidate]);

    // Animate scale and emission
    useFrame((_, delta) => {
        if (!meshRef.current) return;

        // Target scale based on state
        targetScale.current = isDragging ? 1.4 : isFocused || isComparing ? 1.3 : isConfirmed ? 1.5 : 1;
        targetEmission.current = isDragging ? 0.4 : isFocused || isComparing ? 0.3 : isConfirmed ? 0.5 : 0;

        // Smooth interpolation
        const lerpFactor = 1 - Math.exp(-5 * delta);
        const currentScale = meshRef.current.scale.x;
        const newScale = currentScale + (targetScale.current - currentScale) * lerpFactor;
        meshRef.current.scale.setScalar(newScale);

        // Update material emission
        const material = meshRef.current.material as any;
        if (material.emissiveIntensity !== undefined) {
            material.emissiveIntensity +=
                (targetEmission.current - material.emissiveIntensity) * lerpFactor;
        }
    });

    // Handle drag events
    const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
        console.log('PointerDown on', node.id, 'isDraggable:', isDraggable, 'isConnectionMode:', isConnectionMode);
        if (isDraggable && !isConnectionMode) {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();

            // Get initial position for offset calculation
            const startPos = { x: position[0], y: position[1], z: position[2] };
            const startMouse = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };

            // START DRAG with move callback
            dragState.startDrag(e.nativeEvent.pointerId, (mouseX: number, mouseY: number) => {
                // Simple screen delta to 3D delta conversion
                const deltaX = (mouseX - startMouse.x) * 0.01; // Scale factor
                const deltaZ = (mouseY - startMouse.y) * 0.01;

                const newPos: [number, number, number] = [
                    startPos.x + deltaX,
                    startPos.y, // Keep Y constant
                    startPos.z + deltaZ
                ];

                if (onDrag) {
                    onDrag(newPos);
                }
            });

            setIsDragging(true);
            onDragStart?.();
            console.log('Started dragging', node.id);
        }
    };

    const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
        // Movement is now handled by dragState callback
        if (isDragging) {
            e.stopPropagation();
        }
    };

    const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
        console.log('PointerUp on', node.id, 'isDragging:', isDragging);
        if (isDragging) {
            e.stopPropagation();
            // END DRAG - this re-enables camera events
            dragState.endDrag();
            setIsDragging(false);
            onDragEnd?.();
            console.log('Finished dragging', node.id);
        }
    };

    const handleClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        console.log('Node clicked:', node.id, 'shiftKey:', e.nativeEvent.shiftKey, 'isDragable:', isDraggable);
        if (!isDragging) {
            onClick(e.nativeEvent.shiftKey);
        }
    };

    return (
        <group position={position}>
            {/* Invisible larger hit area for easier interaction */}
            <mesh
                onClick={handleClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerOver={(e) => {
                    e.stopPropagation();
                    document.body.style.cursor = isDraggable && !isConnectionMode ? 'grab' : 'pointer';
                }}
                onPointerOut={() => {
                    document.body.style.cursor = 'default';
                }}
            >
                <sphereGeometry args={[0.7, 16, 16]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {/* Visible Node sphere */}
            <mesh
                ref={meshRef}
            >
                <sphereGeometry args={[0.4, 32, 32]} />
                <meshStandardMaterial
                    color={baseColor}
                    emissive={baseColor}
                    emissiveIntensity={0}
                    roughness={0.4}
                    metalness={0.1}
                />
            </mesh>

            {/* Visual indicator for connection mode */}
            {isConnectionCandidate && (
                <mesh position={[0, 0, 0]}>
                    <ringGeometry args={[0.5, 0.6, 32]} />
                    <meshBasicMaterial color="#a78bfa" transparent opacity={0.8} />
                </mesh>
            )}

            {/* Highlight ring for draggable nodes in Creator world */}
            {isDraggable && !isConnectionCandidate && (
                <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.45, 0.5, 32]} />
                    <meshBasicMaterial color="#60a5fa" transparent opacity={0.4} />
                </mesh>
            )}

            {/* Node label */}
            <Text
                position={[0, 0.7, 0]}
                fontSize={0.25}
                color="#e5e7eb"
                anchorX="center"
                anchorY="bottom"
                outlineWidth={0.02}
                outlineColor="#1a1a1a"
            >
                {node.label}
            </Text>
        </group>
    );
}

function EdgeLine({
    from,
    to,
    weight = 0.5,
    isHighlighted,
    isActiveEdge,
}: EdgeLineProps): React.ReactElement {
    const opacity = isActiveEdge ? 0.9 : isHighlighted ? 0.8 : 0.2 + weight * 0.3;
    const color = isActiveEdge ? '#22d3ee' : isHighlighted ? '#60a5fa' : '#4b5563';

    return (
        <Line
            points={[from, to]}
            color={color}
            lineWidth={isActiveEdge ? 3 : isHighlighted ? 2 : 1}
            transparent
            opacity={opacity}
        />
    );

}

interface Graph3DProps {
    nodes: GraphNode[];
    edges: GraphEdge[];
    positions: Map<string, [number, number, number]>;
    focusedNodeId: string | null;
    compareNodeIds: [string, string] | null;
    confirmedNodeId: string | null;
    onNodeClick: (nodeId: string, shiftKey?: boolean) => void;
    worldMode: WorldMode;
    onNodeDrag?: (nodeId: string, position: [number, number, number]) => void;
    connectionModeNodeId?: string | null;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    // Facial state (edge-constrained)
    facialStatePosition?: [number, number, number];
    activeEdge?: ActiveGraphState;
}

interface EdgeLineProps {
    from: [number, number, number];
    to: [number, number, number];
    weight?: number;
    isHighlighted: boolean;
    isActiveEdge?: boolean;
}

export function Graph3D({
    nodes,
    edges,
    positions,
    focusedNodeId,
    compareNodeIds,
    confirmedNodeId,
    onNodeClick,
    worldMode,
    onNodeDrag,
    connectionModeNodeId,
    onDragStart,
    onDragEnd,
    facialStatePosition,
    activeEdge,
}: Graph3DProps): React.ReactElement {
    const isCreatorWorld = worldMode === 'creator';

    // Get active edge key for highlighting
    const activeEdgeKey = activeEdge
        ? `${activeEdge.currentEdge.from}-${activeEdge.currentEdge.to}`
        : null;
    const activeEdgeKeyReverse = activeEdge
        ? `${activeEdge.currentEdge.to}-${activeEdge.currentEdge.from}`
        : null;

    // Get highlighted edges (connected to focused/comparing nodes)
    const highlightedEdges = useMemo(() => {
        const highlighted = new Set<string>();
        const relevantNodes = new Set<string>();

        if (focusedNodeId) {
            relevantNodes.add(focusedNodeId);
        }
        if (compareNodeIds) {
            relevantNodes.add(compareNodeIds[0]);
            relevantNodes.add(compareNodeIds[1]);
        }

        edges.forEach(edge => {
            if (relevantNodes.has(edge.from) || relevantNodes.has(edge.to)) {
                highlighted.add(`${edge.from}-${edge.to}`);
            }
        });

        return highlighted;
    }, [edges, focusedNodeId, compareNodeIds]);

    return (
        <group>
            {/* Render edges first (behind nodes) */}
            {edges.map(edge => {
                const fromPos = positions.get(edge.from);
                const toPos = positions.get(edge.to);
                if (!fromPos || !toPos) return null;

                const edgeKey = `${edge.from}-${edge.to}`;
                const isActive = edgeKey === activeEdgeKey || edgeKey === activeEdgeKeyReverse;
                return (
                    <EdgeLine
                        key={edgeKey}
                        from={fromPos}
                        to={toPos}
                        weight={edge.weight}
                        isHighlighted={highlightedEdges.has(edgeKey)}
                        isActiveEdge={isActive}
                    />
                );
            })}

            {/* Render nodes */}
            {nodes.map(node => {
                const position = positions.get(node.id);
                if (!position) return null;

                const isFocused = focusedNodeId === node.id;
                const isComparing = compareNodeIds?.includes(node.id) || false;
                const isConfirmed = confirmedNodeId === node.id;
                const isDraggable = isCreatorWorld && node.isUserCreated === true;
                const isConnectionMode = !!connectionModeNodeId && node.isUserCreated === true;
                const isConnectionCandidate = connectionModeNodeId === node.id;

                return (
                    <NodeMesh
                        key={node.id}
                        node={node}
                        position={position}
                        isFocused={isFocused}
                        isComparing={isComparing}
                        isConfirmed={isConfirmed}
                        onClick={(shiftKey) => onNodeClick(node.id, shiftKey)}
                        isCreatorWorld={isCreatorWorld}
                        isDraggable={isDraggable}
                        onDrag={onNodeDrag ? (pos) => onNodeDrag(node.id, pos) : undefined}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        isConnectionMode={isConnectionMode}
                        isConnectionCandidate={isConnectionCandidate}
                    />
                );
            })}

            {/* Facial state marker (edge-constrained) */}
            {facialStatePosition && (
                <FacialStateMarker
                    targetPosition={facialStatePosition}
                    visible={true}
                    proximity={0.7}
                />
            )}
        </group>
    );
}
