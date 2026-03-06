// CreatorPortal Component
// A glass sphere visible in Code world that contains the Creator graph inside

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Line, Text } from '@react-three/drei';
import { Mesh, Group } from 'three';
import type { GraphNode, GraphEdge } from '../state/graphState';

interface CreatorPortalProps {
    nodes: GraphNode[];
    edges: GraphEdge[];
    creatorPositions: Map<string, [number, number, number]>;
    position?: [number, number, number];
    radius?: number;
}

export function CreatorPortal({
    nodes,
    edges,
    creatorPositions,
    position = [0, 0, -8],
    radius = 2.5,
}: CreatorPortalProps): React.ReactElement {
    const sphereRef = useRef<Mesh>(null);
    const innerGroupRef = useRef<Group>(null);

    // Scale factor to fit graph inside sphere
    const scale = 0.25;

    // Slowly rotate the inner graph
    useFrame((_, delta) => {
        if (innerGroupRef.current) {
            innerGroupRef.current.rotation.y += delta * 0.1;
        }
    });

    // Render miniature nodes inside
    const miniNodes = useMemo(() => {
        return nodes.map(node => {
            const pos = creatorPositions.get(node.id);
            if (!pos) return null;

            return (
                <mesh
                    key={node.id}
                    position={[pos[0] * scale, pos[1] * scale, pos[2] * scale]}
                >
                    <sphereGeometry args={[0.08, 16, 16]} />
                    <meshStandardMaterial
                        color="#374151"
                        emissive="#374151"
                        emissiveIntensity={0.2}
                    />
                </mesh>
            );
        });
    }, [nodes, creatorPositions, scale]);

    // Render miniature edges inside
    const miniEdges = useMemo(() => {
        return edges.map(edge => {
            const fromPos = creatorPositions.get(edge.from);
            const toPos = creatorPositions.get(edge.to);
            if (!fromPos || !toPos) return null;

            return (
                <Line
                    key={`${edge.from}-${edge.to}`}
                    points={[
                        [fromPos[0] * scale, fromPos[1] * scale, fromPos[2] * scale],
                        [toPos[0] * scale, toPos[1] * scale, toPos[2] * scale],
                    ]}
                    color="#9ca3af"
                    lineWidth={1}
                    transparent
                    opacity={0.4}
                />
            );
        });
    }, [edges, creatorPositions, scale]);

    return (
        <group position={position}>
            {/* Glass outer sphere */}
            <Sphere ref={sphereRef} args={[radius, 64, 64]}>
                <meshPhysicalMaterial
                    color="#ffffff"
                    transmission={0.9}
                    thickness={0.5}
                    roughness={0.05}
                    metalness={0}
                    ior={1.5}
                    transparent
                    opacity={0.3}
                    envMapIntensity={1}
                />
            </Sphere>

            {/* Inner glow sphere */}
            <Sphere args={[radius * 0.95, 32, 32]}>
                <meshStandardMaterial
                    color="#f0f0f0"
                    transparent
                    opacity={0.1}
                    side={2}
                />
            </Sphere>

            {/* Inner graph visualization */}
            <group ref={innerGroupRef}>
                {miniNodes}
                {miniEdges}
            </group>

            {/* Label */}
            <Text
                position={[0, radius + 0.5, 0]}
                fontSize={0.3}
                color="#6b7280"
                anchorX="center"
                anchorY="bottom"
            >
                Creator World
            </Text>
        </group>
    );
}
