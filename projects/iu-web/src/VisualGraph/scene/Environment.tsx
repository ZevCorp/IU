// Environment Component
// Dual-world atmosphere: Creator (white) and Code (dark)

import React from 'react';
import type { WorldMode } from '../state/graphState';

interface EnvironmentProps {
    worldMode: WorldMode;
}

export function Environment({ worldMode }: EnvironmentProps): React.ReactElement {
    const isCreator = worldMode === 'creator';

    // Atmosphere settings per world
    const backgroundColor = isCreator ? '#f5f5f5' : '#1a1a1a';
    const fogNear = isCreator ? 12 : 8;
    const fogFar = isCreator ? 30 : 25;
    const ambientIntensity = isCreator ? 0.7 : 0.4;
    const keyLightIntensity = isCreator ? 0.4 : 0.6;
    const keyLightColor = isCreator ? '#ffffff' : '#fff8f0';

    return (
        <>
            {/* Background color */}
            <color attach="background" args={[backgroundColor]} />

            {/* Subtle fog for depth perception */}
            <fog attach="fog" args={[backgroundColor, fogNear, fogFar]} />

            {/* Ambient fill light */}
            <ambientLight intensity={ambientIntensity} color="#ffffff" />

            {/* Main key light */}
            <directionalLight
                position={[5, 8, 5]}
                intensity={keyLightIntensity}
                color={keyLightColor}
                castShadow={false}
            />

            {/* Fill light */}
            <directionalLight
                position={[-4, 3, -2]}
                intensity={isCreator ? 0.2 : 0.3}
                color={isCreator ? '#f0f0f0' : '#e0e8ff'}
                castShadow={false}
            />

            {/* Rim light */}
            <directionalLight
                position={[0, 2, -8]}
                intensity={0.2}
                color="#ffffff"
                castShadow={false}
            />
        </>
    );
}
