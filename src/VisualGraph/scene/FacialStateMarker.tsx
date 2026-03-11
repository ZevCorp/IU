// Facial State Marker Component
// Renders a soft glowing marker showing current facial state position

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh } from 'three';

interface FacialStateMarkerProps {
    targetPosition: [number, number, number];
    visible: boolean;
    proximity?: number; // 0-1, affects glow intensity
}

export function FacialStateMarker({
    targetPosition,
    visible,
    proximity = 0.5
}: FacialStateMarkerProps): React.ReactElement | null {
    const meshRef = useRef<Mesh>(null);
    const currentPosition = useRef<[number, number, number]>([0, 0, 0]);
    const pulsePhase = useRef(0);

    // Animate position and pulse
    useFrame((_, delta) => {
        if (!meshRef.current || !visible) return;

        // Smooth position interpolation (easing)
        const lerpFactor = 1 - Math.exp(-3 * delta);
        currentPosition.current = [
            currentPosition.current[0] + (targetPosition[0] - currentPosition.current[0]) * lerpFactor,
            currentPosition.current[1] + (targetPosition[1] - currentPosition.current[1]) * lerpFactor,
            currentPosition.current[2] + (targetPosition[2] - currentPosition.current[2]) * lerpFactor
        ];

        meshRef.current.position.set(
            currentPosition.current[0],
            currentPosition.current[1],
            currentPosition.current[2]
        );

        // Subtle pulse animation
        pulsePhase.current += delta * 2;
        const pulse = 0.9 + Math.sin(pulsePhase.current) * 0.1;
        meshRef.current.scale.setScalar(pulse);

        // Update emission based on proximity
        const material = meshRef.current.material as any;
        if (material.emissiveIntensity !== undefined) {
            const targetEmission = 0.3 + proximity * 0.4;
            material.emissiveIntensity += (targetEmission - material.emissiveIntensity) * lerpFactor;
        }
    });

    if (!visible) return null;

    return (
        <mesh ref={meshRef}>
            <sphereGeometry args={[0.25, 24, 24]} />
            <meshStandardMaterial
                color="#3b82f6"
                emissive="#3b82f6"
                emissiveIntensity={0.3}
                transparent
                opacity={0.6}
                roughness={0.2}
                metalness={0.3}
            />
        </mesh>
    );
}
