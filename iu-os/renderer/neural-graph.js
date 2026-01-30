/**
 * IÜ OS - Neural Graph Visualization
 * Visualizes HRM navigation as neurons firing through synapses
 */

class NeuralGraph {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = new Map();
        this.edges = [];
        this.particles = [];
        this.isAnimating = false;

        // Visual settings
        this.colors = {
            nodeIdle: '#1a1a2e',
            nodeActive: '#00d4ff',
            nodeFiring: '#b042ff',
            edgeIdle: 'rgba(255, 255, 255, 0.1)',
            edgeActive: 'rgba(0, 212, 255, 0.5)',
            particle: '#00d4ff',
            particleGlow: '#b042ff'
        };

        this.nodeRadius = 8;
        this.particleSpeed = 2;
    }

    /**
     * Add a node (neuron) to the graph
     */
    addNode(id, label, position = null) {
        if (!position) {
            // Auto-position in circular layout
            const count = this.nodes.size;
            const angle = (count / 10) * Math.PI * 2;
            const radius = Math.min(this.canvas.width, this.canvas.height) * 0.3;
            position = {
                x: this.canvas.width / 2 + Math.cos(angle) * radius,
                y: this.canvas.height / 2 + Math.sin(angle) * radius
            };
        }

        this.nodes.set(id, {
            id,
            label,
            x: position.x,
            y: position.y,
            state: 'idle', // idle | firing | activated
            pulsePhase: Math.random() * Math.PI * 2,
            connections: []
        });
    }

    /**
     * Add an edge (synapse) between nodes
     */
    addEdge(fromId, toId, weight = 1) {
        const from = this.nodes.get(fromId);
        const to = this.nodes.get(toId);

        if (from && to) {
            this.edges.push({
                from: fromId,
                to: toId,
                weight,
                active: false,
                lastFired: 0
            });
            from.connections.push(toId);
        }
    }

    /**
     * Fire a neuron - triggers visual animation
     */
    fireNeuron(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) return;

        node.state = 'firing';

        // Create particles for each outgoing connection
        node.connections.forEach(targetId => {
            this.createParticle(nodeId, targetId);
        });

        // Reset state after animation
        setTimeout(() => {
            node.state = 'activated';
            setTimeout(() => {
                node.state = 'idle';
            }, 1000);
        }, 300);
    }

    /**
     * Animate a path through the graph (HRM result visualization)
     */
    async animatePath(path, delayMs = 200) {
        for (let i = 0; i < path.length; i++) {
            this.fireNeuron(path[i]);
            await this.delay(delayMs);
        }
    }

    /**
     * Create a particle that travels along an edge
     */
    createParticle(fromId, toId) {
        const from = this.nodes.get(fromId);
        const to = this.nodes.get(toId);

        if (!from || !to) return;

        this.particles.push({
            fromId,
            toId,
            x: from.x,
            y: from.y,
            targetX: to.x,
            targetY: to.y,
            progress: 0,
            speed: this.particleSpeed
        });

        // Mark edge as active
        const edge = this.edges.find(e => e.from === fromId && e.to === toId);
        if (edge) {
            edge.active = true;
            edge.lastFired = Date.now();
        }
    }

    /**
     * Update particle positions
     */
    updateParticles() {
        this.particles = this.particles.filter(p => {
            p.progress += p.speed / 100;

            if (p.progress >= 1) {
                // Particle reached destination
                const targetNode = this.nodes.get(p.toId);
                if (targetNode) {
                    targetNode.state = 'activated';
                }
                return false;
            }

            // Lerp position
            p.x = this.lerp(this.nodes.get(p.fromId).x, p.targetX, p.progress);
            p.y = this.lerp(this.nodes.get(p.fromId).y, p.targetY, p.progress);

            return true;
        });
    }

    /**
     * Main render loop
     */
    render() {
        const ctx = this.ctx;

        // Clear canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw edges
        this.edges.forEach(edge => {
            const from = this.nodes.get(edge.from);
            const to = this.nodes.get(edge.to);

            if (!from || !to) return;

            const isActive = edge.active && Date.now() - edge.lastFired < 500;

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.strokeStyle = isActive ? this.colors.edgeActive : this.colors.edgeIdle;
            ctx.lineWidth = isActive ? 2 : 1;
            ctx.stroke();

            // Reset active state after glow fades
            if (!isActive && edge.active) {
                edge.active = false;
            }
        });

        // Draw nodes
        this.nodes.forEach(node => {
            const pulse = Math.sin(node.pulsePhase + Date.now() / 500) * 0.2 + 1;
            const radius = this.nodeRadius * (node.state === 'firing' ? 1.5 : pulse);

            // Glow effect for active nodes
            if (node.state !== 'idle') {
                ctx.beginPath();
                const gradient = ctx.createRadialGradient(
                    node.x, node.y, 0,
                    node.x, node.y, radius * 3
                );
                gradient.addColorStop(0, node.state === 'firing' ? this.colors.nodeFiring : this.colors.nodeActive);
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.arc(node.x, node.y, radius * 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // Node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = node.state === 'idle' ? this.colors.nodeIdle :
                node.state === 'firing' ? this.colors.nodeFiring :
                    this.colors.nodeActive;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Draw particles
        this.particles.forEach(p => {
            // Particle glow
            ctx.beginPath();
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 15);
            gradient.addColorStop(0, this.colors.particle);
            gradient.addColorStop(0.5, this.colors.particleGlow);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
            ctx.fill();

            // Particle core
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        });

        // Update particles
        this.updateParticles();
    }

    /**
     * Start animation loop
     */
    start() {
        this.isAnimating = true;
        this.animate();
        console.log('🧠 Neural graph started');
    }

    /**
     * Stop animation loop
     */
    stop() {
        this.isAnimating = false;
        console.log('🧠 Neural graph stopped');
    }

    animate() {
        if (!this.isAnimating) return;

        this.render();
        requestAnimationFrame(() => this.animate());
    }

    /**
     * Load graph from HRM UIGraph format
     */
    loadFromUIGraph(uiGraph) {
        this.clear();

        // Add nodes
        let index = 0;
        uiGraph.nodes.forEach((node, id) => {
            const angle = (index / uiGraph.nodes.size) * Math.PI * 2;
            const radius = Math.min(this.canvas.width, this.canvas.height) * 0.35;
            this.addNode(id, node.screenName, {
                x: this.canvas.width / 2 + Math.cos(angle) * radius,
                y: this.canvas.height / 2 + Math.sin(angle) * radius
            });
            index++;
        });

        // Add edges
        uiGraph.edges.forEach(edge => {
            this.addEdge(edge.from, edge.to, edge.observedCount);
        });
    }

    /**
     * Clear all nodes and edges
     */
    clear() {
        this.nodes.clear();
        this.edges = [];
        this.particles = [];
    }

    // Utilities
    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default NeuralGraph;
