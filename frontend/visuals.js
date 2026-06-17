/**
 * visuals.js - WebGL/Three.js interactive 3D particle background
 * Designed for AI Interview Assistant to react to interview states.
 */

document.addEventListener("DOMContentLoaded", () => {
    if (typeof THREE === 'undefined') {
        console.error("Three.js library is not loaded. WebGL background disabled.");
        return;
    }

    // ========== STATE SETUP ==========
    const states = {
        WELCOME: 'welcome',
        INTERVIEW: 'interview',
        SPEAKING: 'speaking',
        RECORDING: 'recording',
        FEEDBACK: 'feedback'
    };

    let currentState = states.WELCOME;

    // Animation variables (target & current for smooth interpolation/lerp)
    let targetWaveSpeed = 0.4;
    let targetWaveHeight = 1.5;
    let targetWaveFreq = 0.08;
    let targetColorPulse = 0.0;
    let targetNoiseScale = 0.15;

    let currentWaveSpeed = 0.4;
    let currentWaveHeight = 1.5;
    let currentWaveFreq = 0.08;
    let currentColorPulse = 0.0;
    let currentNoiseScale = 0.15;

    let time = 0;
    let isPaused = false;

    // Mouse tracking for camera parallax
    let mouseX = 0;
    let mouseY = 0;

    window.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // ========== SCENE SETUP ==========
    const canvas = document.getElementById("webgl-canvas");
    if (!canvas) {
        console.error("WebGL canvas element not found.");
        return;
    }

    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 14, 24);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Responsive resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ========== GLOW TEXTURE GENERATOR ==========
    function createGlowTexture() {
        const size = 64;
        const canvasTexture = document.createElement('canvas');
        canvasTexture.width = size;
        canvasTexture.height = size;
        const ctx = canvasTexture.getContext('2d');
        
        const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(canvasTexture);
    }

    const glowTexture = createGlowTexture();

    // ========== WAVE PARTICLE FIELD ==========
    const cols = 70;
    const rows = 70;
    const particleCount = cols * rows;

    const positions = new Float32Array(particleCount * 3);
    const initialColors = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const spacing = 0.85;

    let idx = 0;
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            const x = (c - cols / 2) * spacing;
            const z = (r - rows / 2) * spacing;
            const y = 0;

            positions[idx * 3] = x;
            positions[idx * 3 + 1] = y;
            positions[idx * 3 + 2] = z;

            // Generate gradient matching colors: #667eea -> #764ba2 -> #f093fb
            const t = c / (cols - 1);
            let r_col, g_col, b_col;
            if (t < 0.5) {
                // Indigo/Blue #667eea (102, 126, 234) to Purple #764ba2 (118, 75, 162)
                const u = t * 2;
                r_col = (102 + (118 - 102) * u) / 255;
                g_col = (126 + (75 - 126) * u) / 255;
                b_col = (234 + (162 - 234) * u) / 255;
            } else {
                // Purple #764ba2 (118, 75, 162) to Pink/Lavender #f093fb (240, 147, 251)
                const u = (t - 0.5) * 2;
                r_col = (118 + (240 - 118) * u) / 255;
                g_col = (75 + (147 - 75) * u) / 255;
                b_col = (162 + (251 - 162) * u) / 255;
            }

            initialColors[idx * 3] = r_col;
            initialColors[idx * 3 + 1] = g_col;
            initialColors[idx * 3 + 2] = b_col;

            colors[idx * 3] = r_col;
            colors[idx * 3 + 1] = g_col;
            colors[idx * 3 + 2] = b_col;

            idx++;
        }
    }

    const waveGeometry = new THREE.BufferGeometry();
    waveGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    waveGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const waveMaterial = new THREE.PointsMaterial({
        size: 0.55,
        map: glowTexture,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const waveParticles = new THREE.Points(waveGeometry, waveMaterial);
    scene.add(waveParticles);

    // ========== SHOCKWAVE BURST SYSTEM ==========
    const burstCount = 180;
    const burstPositions = new Float32Array(burstCount * 3);
    const burstVelocities = new Float32Array(burstCount * 3);
    const burstColors = new Float32Array(burstCount * 3);

    // Spawn them offscreen/invisible initially
    for (let i = 0; i < burstCount; i++) {
        burstPositions[i * 3] = 9999;
        burstPositions[i * 3 + 1] = 9999;
        burstPositions[i * 3 + 2] = 9999;
        burstVelocities[i * 3] = 0;
        burstVelocities[i * 3 + 1] = 0;
        burstVelocities[i * 3 + 2] = 0;
    }

    const burstGeometry = new THREE.BufferGeometry();
    burstGeometry.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
    burstGeometry.setAttribute('color', new THREE.BufferAttribute(burstColors, 3));

    const burstMaterial = new THREE.PointsMaterial({
        size: 0.9,
        map: glowTexture,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const burstParticles = new THREE.Points(burstGeometry, burstMaterial);
    scene.add(burstParticles);

    let burstActive = false;
    let burstAge = 0;
    const maxBurstAge = 110; // Frames

    function triggerScoreBurst() {
        burstActive = true;
        burstAge = 0;
        
        const posAttr = burstGeometry.attributes.position;
        const colorAttr = burstGeometry.attributes.color;
        
        for (let i = 0; i < burstCount; i++) {
            // Spawn at center, slightly lifted
            posAttr.setXYZ(i, 0, 1, 0);
            
            // Random spherical coordinates velocity
            const speed = Math.random() * 0.45 + 0.15;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            
            const vx = speed * Math.sin(phi) * Math.cos(theta);
            const vy = speed * Math.sin(phi) * Math.sin(theta) * 1.4 + 0.1; // push upward slightly more
            const vz = speed * Math.cos(phi);
            
            burstVelocities[i * 3] = vx;
            burstVelocities[i * 3 + 1] = vy;
            burstVelocities[i * 3 + 2] = vz;
            
            // Fun bright color palette: White, Cyan, Magenta/Pink, Gold
            const rand = Math.random();
            let r, g, b;
            if (rand < 0.25) {
                r = 1.0; g = 1.0; b = 1.0; // Bright white
            } else if (rand < 0.5) {
                r = 0.35; g = 0.85; b = 1.0; // Electric Cyan
            } else if (rand < 0.75) {
                r = 1.0; g = 0.35; b = 0.85; // Vibrant Pink
            } else {
                r = 1.0; g = 0.8; b = 0.15; // Golden yellow
            }
            colorAttr.setXYZ(i, r, g, b);
        }
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
    }

    // ========== STATE CHANGE HANDLER ==========
    function setVisualState(state) {
        if (currentState === state) return;
        currentState = state;
        
        switch (state) {
            case states.WELCOME:
                targetWaveSpeed = 0.35;
                targetWaveHeight = 1.4;
                targetWaveFreq = 0.07;
                targetColorPulse = 0.0;
                targetNoiseScale = 0.12;
                break;
            case states.INTERVIEW:
                targetWaveSpeed = 0.65;
                targetWaveHeight = 2.0;
                targetWaveFreq = 0.11;
                targetColorPulse = 0.0;
                targetNoiseScale = 0.25;
                break;
            case states.SPEAKING:
                targetWaveSpeed = 2.3;
                targetWaveHeight = 4.5;
                targetWaveFreq = 0.22;
                targetColorPulse = 0.0;
                targetNoiseScale = 0.85;
                break;
            case states.RECORDING:
                targetWaveSpeed = 1.1;
                targetWaveHeight = 2.8;
                targetWaveFreq = 0.14;
                targetColorPulse = 1.0; // Pulsate red/pink for recording
                targetNoiseScale = 0.4;
                break;
            case states.FEEDBACK:
                targetWaveSpeed = 0.22;
                targetWaveHeight = 1.0;
                targetWaveFreq = 0.05;
                targetColorPulse = 0.0;
                targetNoiseScale = 0.08;
                break;
        }
    }

    // ========== DOM STATE DETECTOR ==========
    function updateVisualsFromDOMState() {
        const welcomeState = document.getElementById("welcomeState");
        const speakingBubble = document.getElementById("speakingBubble");
        const recordBtn = document.getElementById("recordBtn");
        const feedbackContent = document.getElementById("feedbackContent");
        
        const avatarContainer = document.getElementById("avatarContainer");
        const avatarPulseRing = document.getElementById("avatarPulseRing");

        // 1. Feedback/Score reveal
        if (feedbackContent && !feedbackContent.classList.contains("hidden")) {
            if (currentState !== states.FEEDBACK) {
                setVisualState(states.FEEDBACK);
                triggerScoreBurst();
            }
            if (avatarContainer) avatarContainer.classList.remove("is-speaking");
            if (avatarPulseRing) avatarPulseRing.classList.remove("is-speaking-ring");
            return;
        }

        // 2. Natalie is speaking bubble
        if (speakingBubble && !speakingBubble.classList.contains("hidden")) {
            setVisualState(states.SPEAKING);
            if (avatarContainer) avatarContainer.classList.add("is-speaking");
            if (avatarPulseRing) avatarPulseRing.classList.add("is-speaking-ring");
            return;
        }

        if (avatarContainer) avatarContainer.classList.remove("is-speaking");
        if (avatarPulseRing) avatarPulseRing.classList.remove("is-speaking-ring");

        // 3. User recording audio
        if (recordBtn && recordBtn.classList.contains("recording-active")) {
            setVisualState(states.RECORDING);
            return;
        }

        // 4. Welcome screen (idle)
        if (welcomeState && !welcomeState.classList.contains("hidden")) {
            setVisualState(states.WELCOME);
            return;
        }

        // 5. Default/Waiting during interview
        setVisualState(states.INTERVIEW);
    }

    // ========== MUTATION OBSERVER ==========
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                shouldUpdate = true;
                break;
            }
        }
        if (shouldUpdate) {
            updateVisualsFromDOMState();
        }
    });

    const elementsToWatch = [
        document.getElementById('welcomeState'),
        document.getElementById('speakingBubble'),
        document.getElementById('recordBtn'),
        document.getElementById('feedbackSection'),
        document.getElementById('feedbackContent')
    ];

    elementsToWatch.forEach(el => {
        if (el) {
            observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        }
    });

    // Run initial state detection
    updateVisualsFromDOMState();

    // ========== PAGE VISIBILITY OPTIMIZATION ==========
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            isPaused = true;
        } else {
            if (isPaused) {
                isPaused = false;
                animate();
            }
        }
    });

    // ========== RENDER LOOP ==========
    function animate() {
        if (isPaused) return;

        requestAnimationFrame(animate);

        time += 0.01;

        // Smooth parameter transitions
        currentWaveSpeed += (targetWaveSpeed - currentWaveSpeed) * 0.08;
        currentWaveHeight += (targetWaveHeight - currentWaveHeight) * 0.08;
        currentWaveFreq += (targetWaveFreq - currentWaveFreq) * 0.08;
        currentColorPulse += (targetColorPulse - currentColorPulse) * 0.08;
        currentNoiseScale += (targetNoiseScale - currentNoiseScale) * 0.08;

        const posAttr = waveGeometry.attributes.position;
        const colorAttr = waveGeometry.attributes.color;

        // 1. Update Wave Particles
        for (let i = 0; i < particleCount; i++) {
            const x = posAttr.getX(i);
            const z = posAttr.getZ(i);
            const dist = Math.sqrt(x * x + z * z);

            // Primary wave calculation
            let y = Math.sin(dist * currentWaveFreq - time * currentWaveSpeed) * currentWaveHeight;

            // Secondary turbulent noise wave
            y += Math.cos(x * 0.22 + time * currentWaveSpeed * 0.5) * Math.sin(z * 0.22 + time * currentWaveSpeed * 0.6) * currentWaveHeight * currentNoiseScale;

            posAttr.setY(i, y);

            // Dynamically shift color palette when recording
            const initialR = initialColors[i * 3];
            const initialG = initialColors[i * 3 + 1];
            const initialB = initialColors[i * 3 + 2];

            // Recording color values: soft pulsating red/coral pink
            const recordingR = 239/255 + 0.06 * Math.sin(time * 5.5 + i);
            const recordingG = 60/255 + 0.04 * Math.sin(time * 5.5 + i);
            const recordingB = 90/255 + 0.04 * Math.cos(time * 5.5 + i);

            const r = THREE.MathUtils.lerp(initialR, recordingR, currentColorPulse);
            const g = THREE.MathUtils.lerp(initialG, recordingG, currentColorPulse);
            const b = THREE.MathUtils.lerp(initialB, recordingB, currentColorPulse);

            colorAttr.setXYZ(i, r, g, b);
        }

        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;

        // 2. Update Burst Particles
        if (burstActive) {
            burstAge++;
            const bPosAttr = burstGeometry.attributes.position;
            const bColorAttr = burstGeometry.attributes.color;

            for (let i = 0; i < burstCount; i++) {
                let x = bPosAttr.getX(i);
                let y = bPosAttr.getY(i);
                let z = bPosAttr.getZ(i);

                // Update velocity (drag + gravity)
                burstVelocities[i * 3] *= 0.975;
                burstVelocities[i * 3 + 1] = (burstVelocities[i * 3 + 1] - 0.0025) * 0.975;
                burstVelocities[i * 3 + 2] *= 0.975;

                x += burstVelocities[i * 3];
                y += burstVelocities[i * 3 + 1];
                z += burstVelocities[i * 3 + 2];

                bPosAttr.setXYZ(i, x, y, z);

                // Fade colors to black (additive blending hides black)
                const r = bColorAttr.getX(i) * 0.96;
                const g = bColorAttr.getY(i) * 0.96;
                const b = bColorAttr.getZ(i) * 0.96;
                bColorAttr.setXYZ(i, r, g, b);
            }

            bPosAttr.needsUpdate = true;
            bColorAttr.needsUpdate = true;

            if (burstAge >= maxBurstAge) {
                burstActive = false;
                // Return particles to offscreen safety
                for (let i = 0; i < burstCount; i++) {
                    bPosAttr.setXYZ(i, 9999, 9999, 9999);
                }
                bPosAttr.needsUpdate = true;
            }
        }

        // 3. Camera Position Lerp (drifting camera + mouse parallax)
        const targetCamX = Math.sin(time * 0.04) * 11 + mouseX * 4.5;
        const targetCamY = 13 + mouseY * 3.5;
        const targetCamZ = Math.cos(time * 0.04) * 23;

        camera.position.x += (targetCamX - camera.position.x) * 0.04;
        camera.position.y += (targetCamY - camera.position.y) * 0.04;
        camera.position.z += (targetCamZ - camera.position.z) * 0.04;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
    }

    // Start loop
    animate();
});
