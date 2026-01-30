// CameraRig Component
// Manages cinematic camera with three modes: Exploration, Transaction, Decision

import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Bounds } from '@react-three/drei';
import { Vector3 } from 'three';
import type { CameraMode } from '../state/graphState';
import { dragState } from '../state/dragState';

interface CameraRigProps {
    mode: CameraMode;
    targetPosition?: [number, number, number];
    comparePositions?: [[number, number, number], [number, number, number]];
    transitionSpeed?: number;
    isDragActive?: boolean;
}

export function CameraRig({
    mode,
    targetPosition,
    comparePositions,
    transitionSpeed = 0.8,
    isDragActive = false,
}: CameraRigProps): React.ReactElement {
    const controlsRef = useRef<CameraControls>(null);
    const { camera } = useThree();

    // Target vectors for smooth transitions
    const targetLookAt = useRef(new Vector3(0, 0, 0));
    const targetCameraPos = useRef(new Vector3(0, 3, 10));

    // Register camera controls with dragState for sync disconnect
    useEffect(() => {
        if (controlsRef.current) {
            dragState.setCameraControls(controlsRef.current);
        }
        return () => {
            dragState.setCameraControls(null);
        };
    }, []);

    // Disable controls when dragging nodes
    useEffect(() => {
        if (!controlsRef.current) return;
        if (isDragActive) {
            controlsRef.current.enabled = false;
        } else if (mode !== 'decision') {
            // Only re-enable if not in decision mode
            controlsRef.current.enabled = true;
        }
    }, [isDragActive, mode]);

    useEffect(() => {
        if (!controlsRef.current) return;

        // Don't modify controls if we're currently dragging
        if (isDragActive) return;

        switch (mode) {
            case 'exploration':
                // Enable orbit controls, reset to default view
                controlsRef.current.enabled = true;
                controlsRef.current.minDistance = 6;
                controlsRef.current.maxDistance = 20;
                controlsRef.current.minPolarAngle = Math.PI * 0.2;
                controlsRef.current.maxPolarAngle = Math.PI * 0.7;

                // Smooth return to center
                targetLookAt.current.set(0, 0, 0);
                targetCameraPos.current.set(0, 3, 12);
                break;

            case 'transaction':
                // Focus on single node - allow orbit around it
                controlsRef.current.enabled = true;
                controlsRef.current.minDistance = 3;
                controlsRef.current.maxDistance = 12;

                if (targetPosition) {
                    const [x, y, z] = targetPosition;
                    // Set orbit target to the focused node
                    controlsRef.current.setTarget(x, y, z, true);
                }
                break;

            case 'decision':
                // Frame two nodes for comparison - lock controls
                controlsRef.current.enabled = false;

                if (comparePositions) {
                    const [[x1, y1, z1], [x2, y2, z2]] = comparePositions;
                    // Center between the two nodes
                    const centerX = (x1 + x2) / 2;
                    const centerY = (y1 + y2) / 2;
                    const centerZ = (z1 + z2) / 2;

                    targetLookAt.current.set(centerX, centerY, centerZ);

                    // Calculate distance to frame both nodes
                    const dist = Math.sqrt(
                        (x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2
                    );
                    const cameraDistance = Math.max(dist * 1.5, 6);

                    targetCameraPos.current.set(
                        centerX,
                        centerY + 1.5,
                        centerZ + cameraDistance
                    );
                }
                break;
        }
    }, [mode, targetPosition, comparePositions, isDragActive]);

    // Track whether controls are connected
    const isConnected = useRef(true);

    // Smooth camera transitions with easing
    useFrame((_, delta) => {
        if (!controlsRef.current) return;

        // DISCONNECT controls completely when dragging
        if (dragState.isDragging) {
            if (isConnected.current) {
                controlsRef.current.disconnect();
                isConnected.current = false;
                console.log('Camera DISCONNECTED for drag');
            }
            return;
        } else {
            // RECONNECT when not dragging
            if (!isConnected.current) {
                // Use any to bypass type checking - the method exists at runtime
                (controlsRef.current as any).connect(document.querySelector('canvas'));
                isConnected.current = true;
                console.log('Camera RECONNECTED after drag');
            }
        }

        // Only animate when controls are disabled (Decision mode)
        if (!controlsRef.current.enabled && mode === 'decision') {
            const lerpFactor = 1 - Math.exp(-transitionSpeed * delta * 3);
            camera.position.lerp(targetCameraPos.current, lerpFactor);
            controlsRef.current.setLookAt(
                camera.position.x,
                camera.position.y,
                camera.position.z,
                targetLookAt.current.x,
                targetLookAt.current.y,
                targetLookAt.current.z,
                false
            );
        }
    });

    return (
        <CameraControls
            ref={controlsRef}
            makeDefault
            smoothTime={0.25}
            dollySpeed={0.5}
            truckSpeed={0.5}
        />
    );
}
