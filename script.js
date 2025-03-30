// Ensure requestAnimationFrame is available
window.requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;

// --- Core Setup ---
let scene, camera, renderer, clock, loadingManager;
let physicsWorld, physicsDebugger; // Optional Cannon-es debugger
let audioContext, audioListener;
const loadedSounds = {}; // To store loaded audio buffers
let assetsLoaded = false;

// --- Game State ---
let score = 0;
let consecutiveHits = 0;
let comboMultiplier = 1.0;
const targets = []; // To keep track of active targets (both mesh and body)
const targetTypes = {
    STANDARD: { points: 10, color: 0xffa500, sound: 'hit_standard' }, // Orange
    BONUS: { points: 25, color: 0x00ff00, sound: 'hit_bonus' },    // Green
    PENALTY: { points: -15, color: 0xff0000, sound: 'hit_penalty' }   // Red
};
let maxTargets = 15;
let targetSpawnInterval = 1.0; // seconds
let timeSinceLastSpawn = 0;

// --- Input & Raycasting ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// --- Constants ---
const SHOOT_DISTANCE = 100; // Max distance the raycast checks
const COMBO_THRESHOLDS = {
    1: 1.0, // 0-4 hits
    5: 1.5, // 5-9 hits
    10: 2.0, // 10-14 hits
    15: 3.0, // 15+ hits
};

// --- DOM Elements ---
const scoreElement = document.getElementById('score');
const comboElement = document.getElementById('combo');
const loadingElement = document.getElementById('loading');
const canvas = document.getElementById('gameCanvas');

// --- Initialization ---
function init() {
    // Loading Manager
    loadingManager = new THREE.LoadingManager(() => {
        assetsLoaded = true;
        loadingElement.style.display = 'none';
        console.log("Assets Loaded!");
        startGameLogic(); // Start game logic only after assets are loaded
    }, (url, itemsLoaded, itemsTotal) => {
        console.log(`Loading file: ${url}. Loaded ${itemsLoaded} of ${itemsTotal} files.`);
        loadingElement.style.display = 'block';
    }, (url) => {
        console.error('There was an error loading ' + url);
        loadingElement.innerText = 'Error loading assets. Please refresh.';
    });


    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x33334d); // Dark blue/grey sky
    scene.fog = new THREE.Fog(0x33334d, 50, 150);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 5); // Positioned like a person standing
    camera.lookAt(0, 1, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows

    // Clock
    clock = new THREE.Clock();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.6); // Brighter ambient
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Brighter directional
    directionalLight.position.set(10, 20, 15);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -20;
    directionalLight.shadow.camera.right = 20;
    directionalLight.shadow.camera.top = 20;
    directionalLight.shadow.camera.bottom = -20;
    scene.add(directionalLight);
    // const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera); // Debug
    // scene.add(shadowHelper); // Debug

    // Ground Plane (Visual)
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Physics World
    physicsWorld = new CANNON.World();
    physicsWorld.gravity.set(0, -9.82, 0); // Standard gravity
    physicsWorld.broadphase = new CANNON.NaiveBroadphase(); // Simple broadphase
    // physicsWorld.solver.iterations = 10; // Adjust solver iterations if needed

    // Physics Ground Plane
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0 }); // mass 0 makes it static
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // Align with visual ground
    physicsWorld.addBody(groundBody);

    // Audio Setup
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioListener = new THREE.AudioListener();
        camera.add(audioListener); // Attach listener to camera for spatial audio relative to player
        loadSounds();
    } catch (e) {
        console.warn("Web Audio API not supported or context creation failed.", e);
        // Provide fallback or disable audio features
    }


    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    // Use 'pointerdown' for unified mouse/touch input
    window.addEventListener('pointerdown', shoot);

    // Start Animation Loop only after basic setup
    // The actual game logic starts after assets load in startGameLogic()
    animate();
}

// --- Audio Handling ---
function loadSounds() {
    const soundFiles = {
        hit_standard: 'sounds/hit_standard.wav', // *** REPLACE WITH YOUR PATH ***
        hit_bonus: 'sounds/hit_bonus.wav',       // *** REPLACE WITH YOUR PATH ***
        hit_penalty: 'sounds/hit_penalty.wav',   // *** REPLACE WITH YOUR PATH ***
        miss: 'sounds/miss.wav'                // *** REPLACE WITH YOUR PATH ***
        // Add more sounds as needed (e.g., background music, UI sounds)
    };

    const loader = new THREE.AudioLoader(loadingManager); // Use the loading manager

    Object.keys(soundFiles).forEach(key => {
        loader.load(soundFiles[key], (buffer) => {
            loadedSounds[key] = buffer;
            console.log(`Sound loaded: ${key}`);
        }, undefined, (err) => {
            console.error(`Failed to load sound ${key}:`, err);
        });
    });
}


function playSound(soundKey, position = null, volume = 1.0, playbackRate = 1.0) {
    if (!audioContext || !loadedSounds[soundKey]) {
        // console.warn(`Sound not loaded or audio context unavailable: ${soundKey}`);
        return;
    }

    const source = audioContext.createBufferSource();
    source.buffer = loadedSounds[soundKey];
    source.playbackRate.value = playbackRate;

    if (position && audioListener) {
        // Spatial sound
        const panner = audioContext.createPanner();
        panner.panningModel = 'HRTF'; // High-quality spatialization
        panner.distanceModel = 'inverse'; // Sound gets quieter with distance
        panner.refDistance = 1;
        panner.maxDistance = 100;
        panner.rolloffFactor = 1;
        panner.coneInnerAngle = 360; // Sound radiates equally in all directions
        panner.coneOuterAngle = 0;
        panner.coneOuterGain = 0;

        // Set position relative to the listener (camera)
        // Convert world position to listener's local space if needed, but for simple cases:
        panner.positionX.setValueAtTime(position.x, audioContext.currentTime);
        panner.positionY.setValueAtTime(position.y, audioContext.currentTime);
        panner.positionZ.setValueAtTime(position.z, audioContext.currentTime);

        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

        source.connect(panner);
        panner.connect(gainNode);
        gainNode.connect(audioContext.destination);

    } else {
        // Non-spatial sound (e.g., UI click, miss sound)
         const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
    }

    source.start(0);
}


// --- Game Logic ---
function startGameLogic() {
    console.log("Starting Game Logic...");
    // Initial target spawning etc. can go here
    // Reset score/combo if restarting
    score = 0;
    consecutiveHits = 0;
    updateCombo(); // Updates multiplier and UI
    updateScoreUI();
}

function update(deltaTime) {
    if (!assetsLoaded) return; // Don't run game logic until assets are ready

    // Step the physics world
    physicsWorld.step(1 / 60, deltaTime, 3); // Fixed timestep, delta, max sub-steps

    // Target Spawning
    timeSinceLastSpawn += deltaTime;
    if (timeSinceLastSpawn > targetSpawnInterval && targets.length < maxTargets) {
        spawnTarget();
        timeSinceLastSpawn = 0;
         // Maybe slightly vary spawn interval
        targetSpawnInterval = 0.8 + Math.random() * 0.7;
    }


    // Synchronize physics bodies with visual meshes
    targets.forEach((targetData, index) => {
        targetData.mesh.position.copy(targetData.body.position);
        targetData.mesh.quaternion.copy(targetData.body.quaternion);

        // Optional: Remove targets that fall too far or exist too long
        if (targetData.body.position.y < -10) {
            console.log("Target fell out of bounds");
            removeTarget(targetData, index);
        }
    });
}


function spawnTarget() {
    const typeKeys = Object.keys(targetTypes);
    const randomTypeKey = typeKeys[Math.floor(Math.random() * typeKeys.length)];
    const type = targetTypes[randomTypeKey];

    // Visual representation (Three.js Mesh)
    // Using Box for simplicity, replace with loaded models if desired
    const geometry = new THREE.BoxGeometry(0.5, 1, 0.2); // Target shape
    const material = new THREE.MeshStandardMaterial({ color: type.color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Random spawn position within a range
    const spawnX = (Math.random() - 0.5) * 20; // -10 to 10
    const spawnY = Math.random() * 5 + 2;      // 2 to 7 units high
    const spawnZ = (Math.random() - 0.8) * 15; // -12 to -3 units deep

    mesh.position.set(spawnX, spawnY, spawnZ);

    // Physical representation (Cannon.js Body)
    const shape = new CANNON.Box(new CANNON.Vec3(0.25, 0.5, 0.1)); // Half-extents match geometry
    const body = new CANNON.Body({
        mass: 1, // Give targets some mass
        position: new CANNON.Vec3(spawnX, spawnY, spawnZ),
        shape: shape,
        // material: targetPhysicsMaterial // Optional: Define custom physics material
    });

    // Give it a random initial velocity/spin?
    body.velocity.set((Math.random() - 0.5) * 2, Math.random() * 3, (Math.random() - 0.5) * 2);
    body.angularVelocity.set((Math.random()-0.5) * 3, (Math.random()-0.5) * 3, (Math.random()-0.5) * 3);


    // Link mesh and body together using userData for easy lookup on hit
    const targetData = {
        mesh: mesh,
        body: body,
        type: type,
        id: mesh.uuid // Unique ID for tracking
    };
    mesh.userData.targetData = targetData; // Link from mesh back to data/body

    // Add to worlds
    scene.add(mesh);
    physicsWorld.addBody(body);
    targets.push(targetData);

     // Add listener to remove body if it sleeps (optional optimization)
    // body.addEventListener("sleep", () => {
    //     // Could remove targets that settle and aren't hit after a while
    //     // Be careful not to remove targets the player might still shoot
    // });
}


function shoot(event) {
    if (!assetsLoaded) return; // Don't shoot if not ready

    // Calculate pointer position in normalized device coordinates (-1 to +1)
    // Adjust for touch events if necessary
    let clientX, clientY;
    if (event.changedTouches) { // Check if it's a touch event
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else { // Mouse event
      clientX = event.clientX;
      clientY = event.clientY;
    }

    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;

    // Update the picking ray with the camera and pointer position
    raycaster.setFromCamera(pointer, camera);
    raycaster.far = SHOOT_DISTANCE; // Set max distance

    // Calculate objects intersecting the picking ray
    // IMPORTANT: Check against the Three.js meshes
    const intersects = raycaster.intersectObjects(targets.map(t => t.mesh), false); // Check only target meshes


    if (intersects.length > 0) {
        // --- Hit Logic ---
        const hitObject = intersects[0].object; // Closest object hit
        const hitPoint = intersects[0].point; // World coordinates of the hit

        // Find the corresponding target data using userData
        const targetData = hitObject.userData.targetData;

        if (targetData) {
            // --- Penetration Check Foundation ---
            // For penetration, you would loop through `intersects` here.
            // If intersects[0] is penetrable, check intersects[1], etc.
            // Apply score/effects for each penetrated target.
            // For now, we only process the first hit:

            processHit(targetData, hitPoint);

            // Find the index to remove it from our tracking array
            const targetIndex = targets.findIndex(t => t.id === targetData.id);
            if (targetIndex > -1) {
                removeTarget(targetData, targetIndex);
            } else {
                console.warn("Hit target not found in tracking array?");
            }

        } else {
             console.warn("Hit mesh did not have targetData!");
             processMiss(); // Treat as miss if data association is broken
        }

    } else {
        // --- Miss Logic ---
        processMiss();
    }
}

function processHit(targetData, hitPosition) {
     consecutiveHits++;
     updateCombo(); // Update multiplier before calculating score

     const pointsEarned = Math.round(targetData.type.points * comboMultiplier);
     score += pointsEarned;
     console.log(`Hit! Type: ${Object.keys(targetTypes).find(k=>targetTypes[k] === targetData.type)}, Points: ${pointsEarned} (Base: ${targetData.type.points} x Combo: ${comboMultiplier.toFixed(1)})`);

     updateScoreUI();

     // Play spatialized hit sound
     playSound(targetData.type.sound, hitPosition);

     // Add visual feedback (e.g., particle effect) at hitPosition here
}

function processMiss() {
    if (consecutiveHits > 0) {
        console.log("Miss! Combo Reset.");
    }
    consecutiveHits = 0;
    updateCombo();
    playSound('miss', null, 0.5); // Play miss sound non-spatially
}

function removeTarget(targetData, index) {
    // Remove from Three.js scene
    scene.remove(targetData.mesh);
    // Dispose geometry and material to free GPU memory (important!)
    if (targetData.mesh.geometry) targetData.mesh.geometry.dispose();
    if (targetData.mesh.material) targetData.mesh.material.dispose();

    // Remove from Cannon.js world
    physicsWorld.removeBody(targetData.body);

    // Remove from our tracking array
    targets.splice(index, 1);
}

function updateCombo() {
    let newMultiplier = COMBO_THRESHOLDS[1]; // Default
    for (const hits in COMBO_THRESHOLDS) {
        if (consecutiveHits >= parseInt(hits)) {
            newMultiplier = COMBO_THRESHOLDS[hits];
        }
    }
    comboMultiplier = newMultiplier;
    comboElement.textContent = `Combo: x${comboMultiplier.toFixed(1)}`;
}

function updateScoreUI() {
    scoreElement.textContent = `Score: ${score}`;
}


// --- Rendering Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    // Run game logic updates
    update(deltaTime);

    // Render the scene
    renderer.render(scene, camera);
}

// --- Event Handlers ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Start ---
init(); // Initialize everything
