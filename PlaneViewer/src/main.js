// Use bare imports so Vite (or another bundler/dev server) resolves the package from
// node_modules. This avoids browser errors like "Failed to resolve module specifier 'three'".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './style.css';

// Debug flag to make plane lights extremely visible while debugging
const DEBUG_LIGHTS = false;

// --- Global Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });

// Optimize rendering for performance while scaling planes
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for performance
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Set a very dark background
scene.background = new THREE.Color(0x02001A); // Almost black, deep night sky blue
renderer.setSize(window.innerWidth, window.innerHeight);
// Attach canvas to the #app container if present to avoid layout/CSS conflicts
const appRoot = document.getElementById('app');
(appRoot || document.body).appendChild(renderer.domElement);

// Create a green "grass" ground to replace the default gray grid
// We'll generate a small canvas texture with a green gradient and subtle blade strokes,
// then tile it over a large plane.
const planeSize = 2000;
// Ground height (where the grid lies)
const GROUND_HEIGHT = 0;

// --- Altitude Limits (EDIT THESE TO ADJUST FLIGHT FLOOR AND CEILING) ---
const MIN_HEIGHT = 15;   // Minimum altitude floor (units above ground)
const MAX_HEIGHT = 300;  // Maximum altitude ceiling (units above ground)
const FLOOR_BUFFER = 40;                 // Start cushioning this many units above MIN_HEIGHT (was 20)
const SPAWN_FLOOR_MIN_OFFSET = 30;       // Absolute minimum spawn/respawn height above MIN_HEIGHT (was 10)
const NEAR_FLOOR_SPEED_BIAS_OFFSET = 60; // If within this of MIN_HEIGHT, bias vSpeed upward (was 30)
const FLOOR_CLAMP_OFFSET = 20;           // Hard clamp floor at MIN_HEIGHT + this offset (was 10)

// --- Spawn altitude band (keeps planes comfortably away from floor buffer and ceiling) ---
const SPAWN_MIN_FROM_BUFFER = 20;        // Additional distance above the start of cushioning
const SPAWN_CEILING_MARGIN = 35;         // Keep spawns below ceiling by this margin

// Compute a safe spawn altitude given the plane's cruise band
function computeSpawnAltitude(minCruise, altitudeCeiling) {
    // Start at least this far above MIN_HEIGHT so planes have room to wander
    const minAlt = Math.max(
        MIN_HEIGHT + FLOOR_BUFFER + SPAWN_MIN_FROM_BUFFER,
        MIN_HEIGHT + SPAWN_FLOOR_MIN_OFFSET,
        minCruise * 0.95
    );
    const maxAlt = Math.max(minAlt + 5, altitudeCeiling - SPAWN_CEILING_MARGIN);
    // Choose uniformly within [minAlt, maxAlt]
    const alt = THREE.MathUtils.clamp(
        minAlt + Math.random() * (maxAlt - minAlt),
        MIN_HEIGHT + SPAWN_FLOOR_MIN_OFFSET,
        altitudeCeiling - SPAWN_CEILING_MARGIN
    );
    return alt;
}

// Spawn/despawn bounding boxes (sizes)
const SPAWN_BOX_SIZE = 600; // small box around camera where planes spawn frequently
const DESPAWN_BOX_SIZE = planeSize; // beyond this box planes will be respawned
const SPAWN_NEAR_PROB = 0.8; // probability a respawn will be near the camera

const grassCanvas = document.createElement('canvas');
grassCanvas.width = 1024;
grassCanvas.height = 1024;
const gctx = grassCanvas.getContext('2d');

// Create a more vibrant grass texture with multiple layers
// Base layer: rich green gradient
const grd = gctx.createLinearGradient(0, 0, 0, grassCanvas.height);
grd.addColorStop(0, '#1a4d1a');      // darker green at top
grd.addColorStop(0.3, '#2d7a2d');    // medium-dark
grd.addColorStop(0.5, '#48a448ff');    // medium green
grd.addColorStop(0.7, '#53a153ff');    // lighter green
grd.addColorStop(1, '#71bf71ff');      // light green at bottom

gctx.fillStyle = grd;
gctx.fillRect(0, 0, grassCanvas.width, grassCanvas.height);

// Add subtle noise variation using small dots
gctx.fillStyle = 'rgba(0, 50, 0, 0.08)';
for (let i = 0; i < 4000; i++) {
    const x = Math.random() * grassCanvas.width;
    const y = Math.random() * grassCanvas.height;
    const size = Math.random() * 1.5;
    gctx.fillRect(x, y, size, size);
}

// Add bright highlights for depth
gctx.fillStyle = 'rgba(100, 200, 50, 0.06)';
for (let i = 0; i < 3000; i++) {
    const x = Math.random() * grassCanvas.width;
    const y = Math.random() * grassCanvas.height;
    const size = Math.random() * 1.2;
    gctx.fillRect(x, y, size, size);
}

// Draw grass blades: more numerous, varied, and with better curves
// Longer, more realistic grass strokes
gctx.strokeStyle = 'rgba(20, 80, 20, 0.12)';
gctx.lineWidth = 1.2;
for (let i = 0; i < 3500; i++) {
    const x = Math.random() * grassCanvas.width;
    const y = Math.random() * grassCanvas.height;
    const len = 8 + Math.random() * 32;
    const angle = Math.random() * 0.4 - 0.2; // slight variation in blade angle
    
    gctx.beginPath();
    gctx.moveTo(x, y);
    
    // More curved blade for natural look
    const curveAmount = (Math.random() - 0.5) * 8;
    const midX = x + Math.sin(angle) * len * 0.5 + curveAmount;
    const midY = y - len * 0.5;
    const endX = x + Math.sin(angle) * len;
    const endY = y - len;
    
    gctx.quadraticCurveTo(midX, midY, endX, endY);
    gctx.stroke();
}

// Add lighter grass blades for highlights and depth
gctx.strokeStyle = 'rgba(150, 220, 100, 0.08)';
gctx.lineWidth = 0.8;
for (let i = 0; i < 2500; i++) {
    const x = Math.random() * grassCanvas.width;
    const y = Math.random() * grassCanvas.height;
    const len = 10 + Math.random() * 28;
    const angle = Math.random() * 0.4 - 0.2;
    
    gctx.beginPath();
    gctx.moveTo(x, y);
    
    const curveAmount = (Math.random() - 0.5) * 6;
    const midX = x + Math.sin(angle) * len * 0.5 + curveAmount;
    const midY = y - len * 0.5;
    const endX = x + Math.sin(angle) * len;
    const endY = y - len;
    
    gctx.quadraticCurveTo(midX, midY, endX, endY);
    gctx.stroke();
}

// Add some darker shadow spots for variation
gctx.fillStyle = 'rgba(0, 40, 0, 0.04)';
for (let i = 0; i < 800; i++) {
    const x = Math.random() * grassCanvas.width;
    const y = Math.random() * grassCanvas.height;
    const size = 10 + Math.random() * 40;
    gctx.fillRect(x, y, size, size);
}

// Final soft overlay to blend and soften the texture
gctx.globalAlpha = 0.1;
gctx.fillStyle = grd;
gctx.fillRect(0, 0, grassCanvas.width, grassCanvas.height);
gctx.globalAlpha = 1.0;

const grassTexture = new THREE.CanvasTexture(grassCanvas);
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(planeSize / 64, planeSize / 64);

const groundMat = new THREE.MeshStandardMaterial({ 
    map: grassTexture,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_HEIGHT - 0.01; // slightly below grid line to avoid z-fighting
ground.receiveShadow = true;
scene.add(ground);



// --- Sky dome ---
// A large inverted sphere that follows the camera and only renders above the ground height.
const SKY_RADIUS = 2000;
const skyGeom = new THREE.SphereGeometry(SKY_RADIUS, 32, 15);
// Invert the geometry so its inside is visible
skyGeom.scale(-1, 1, 1);

const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
        groundHeight: { value: GROUND_HEIGHT }
    },
    vertexShader: `
        varying vec3 vWorldPos;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec3 vWorldPos;
        uniform float groundHeight;
        void main() {
            // Smooth step to blend the sky in above the ground
            float h = smoothstep(groundHeight, groundHeight + 40.0, vWorldPos.y);
            // Sky color gradient from deep night to a slightly lighter horizon
            vec3 topColor = vec3(0.01, 0.03, 0.12);
            vec3 horizonColor = vec3(0.02, 0.06, 0.18);
            vec3 color = mix(horizonColor, topColor, clamp((vWorldPos.y - groundHeight) / 400.0, 0.0, 1.0));

            // If we're below the small fade region, discard to show ground/objects instead
            if (h < 0.01) discard;

            gl_FragColor = vec4(color, 1.0);
        }
    `
});

const skyMesh = new THREE.Mesh(skyGeom, skyMaterial);
skyMesh.renderOrder = -1;
scene.add(skyMesh);

// Ensure camera far plane reaches the sky objects so they don't get clipped
camera.far = Math.max(camera.far, SKY_RADIUS * 1.5);
camera.updateProjectionMatrix();

// --- Stars and Moon ---
// We'll create a skyObjects group that follows the camera so stars/moon appear infinitely far.
const skyObjects = new THREE.Group();
scene.add(skyObjects);

function createStars(count = 200) {
    const starGeo = new THREE.SphereGeometry(0.6, 8, 8);
    for (let i = 0; i < count; i++) {
        // random point on hemisphere above ground
        let theta = Math.random() * Math.PI * 2;
        let phi = Math.random() * (Math.PI / 2); // 0..90deg (above horizon)
        // place stars well within SKY_RADIUS so they're inside the camera far plane
        const r = SKY_RADIUS * (0.5 + Math.random() * 0.45);
        const x = r * Math.cos(theta) * Math.sin(phi);
        const y = r * Math.cos(phi) + GROUND_HEIGHT + 50; // bias upward
        const z = r * Math.sin(theta) * Math.sin(phi);

        const color = Math.random() > 0.85 ? 0xfff2b3 : 0xffffff; // some warm stars
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    // Render stars on top of scene geometry so they're always visible
    mat.depthTest = false;
        const star = new THREE.Mesh(starGeo, mat);
        star.position.set(x, y, z);
    const scale = 0.6 + Math.random() * 1.6;
    star.scale.setScalar(scale);
    star.renderOrder = 1000;
    skyObjects.add(star);
    }
}

function createMoon() {
    const moonRadius = 50;
    const moonGeo = new THREE.SphereGeometry(moonRadius, 32, 16);
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xf6f3e1, emissive: 0xffffee, emissiveIntensity: 1.2, roughness: 0.8 });
    // ensure moon is always visible (rendered on top)
    moonMat.depthTest = false;
    const moon = new THREE.Mesh(moonGeo, moonMat);
    // place moon in the sky (somewhere above and to the side) but within camera.far
    const dir = new THREE.Vector3(-0.4, 0.8, -1).normalize();
    const moonDist = Math.min(SKY_RADIUS - 80, camera.far * 0.9);
    moon.position.copy(dir.clone().multiplyScalar(moonDist));
    skyObjects.add(moon);

    // add a gentle point light for the moon
    const moonLight = new THREE.PointLight(0xffffff, 1.6, camera.far * 0.9, 1);
    moonLight.position.copy(moon.position);
    skyObjects.add(moonLight);
    // render moon on top
    moon.renderOrder = 1000;
}

createStars(240);
createMoon();

// (camera position set after parenting below)

// Use pointer lock so the user can click to look around (mouse movement rotates view).
// We keep the camera position on the ground (y fixed) and only allow rotation.
// We'll create a yaw object and parent the camera to it. We'll rotate the yawObject
// on pointer movement's X axis only. The camera's local rotation/pitch/roll will be
// kept at zero so there's no pitch or roll.
const yawObject = new THREE.Object3D();
yawObject.position.set(0, 0, 0);
// pitchObject will handle up/down rotation; camera remains child of pitchObject
const pitchObject = new THREE.Object3D();
pitchObject.add(camera);
yawObject.add(pitchObject);
scene.add(yawObject);

let isLocked = false;

// Request pointer lock when the user clicks the renderer canvas
renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
});

// Pointer lock change events to show/hide instructions
document.addEventListener('pointerlockchange', () => {
    isLocked = document.pointerLockElement === renderer.domElement;
    instructions.style.display = isLocked ? 'none' : 'block';
});

// UI hint: simple overlay that tells the user to click to lock pointer and WASD controls
const instructions = document.createElement('div');
instructions.style.position = 'absolute';
instructions.style.top = '10px';
instructions.style.left = '10px';
instructions.style.padding = '8px 12px';
instructions.style.background = 'rgba(0,0,0,0.6)';
instructions.style.color = '#fff';
instructions.style.fontFamily = 'sans-serif';
instructions.style.fontSize = '13px';
instructions.style.borderRadius = '4px';
instructions.style.zIndex = '999';
instructions.innerText = 'Click to look around (Esc to release) | WASD: move | Q/E: down/up | F: fullscreen';
document.body.appendChild(instructions);

// --- WASD Movement State ---
const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    speed: 80 // units per second (ground movement speed)
};

// Map keys to movement flags
function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': movement.forward = true; event.preventDefault(); break;
        case 'KeyS': movement.backward = true; event.preventDefault(); break;
        case 'KeyA': movement.left = true; event.preventDefault(); break;
        case 'KeyD': movement.right = true; event.preventDefault(); break;
        case 'KeyQ': movement.down = true; event.preventDefault(); break; // descend
        case 'KeyE': movement.up = true; event.preventDefault(); break;   // ascend
        case 'KeyF': toggleFullscreen(); event.preventDefault(); break;   // F = fullscreen toggle
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': movement.forward = false; break;
        case 'KeyS': movement.backward = false; break;
        case 'KeyA': movement.left = false; break;
        case 'KeyD': movement.right = false; break;
        case 'KeyQ': movement.down = false; break;
        case 'KeyE': movement.up = false; break;
    }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

// --- Fullscreen Toggle ---
const fsButton = document.createElement('button');
fsButton.textContent = '⛶ Fullscreen (F)';
fsButton.title = 'Toggle fullscreen (F)';
Object.assign(fsButton.style, {
    position: 'absolute',
    right: '12px',
    top: '12px',
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '4px',
    cursor: 'pointer',
    zIndex: '9999',
    fontFamily: 'sans-serif',
    fontSize: '12px',
    backdropFilter: 'blur(4px)'
});
fsButton.addEventListener('click', toggleFullscreen);
document.body.appendChild(fsButton);

function updateFsButton() {
    if (document.fullscreenElement) fsButton.textContent = '⤫ Exit Fullscreen (F)';
    else fsButton.textContent = '⛶ Fullscreen (F)';
}

document.addEventListener('fullscreenchange', updateFsButton);

async function toggleFullscreen() {
    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch (err) {
        console.warn('Fullscreen toggle failed:', err);
    }
}

// Mouse movement: apply yaw and pitch (yaw full 360°, pitch clamped)
const MOUSE_SENSITIVITY = 0.0022;
document.addEventListener('mousemove', (event) => {
    if (!isLocked) return;
    // rotate yaw only (around world Y)
    yawObject.rotation.y -= event.movementX * MOUSE_SENSITIVITY;
    // Apply pitch (rotate around local X of pitchObject)
    pitchObject.rotation.x -= event.movementY * MOUSE_SENSITIVITY;
    // Clamp pitch so user can't look through the ground: allow looking up (~+90deg)
    // and only a small downward tilt.
    const MIN_PITCH = -0.15; // small downward tilt (radians)
    const MAX_PITCH = Math.PI / 2 - 0.01; // nearly straight up
    pitchObject.rotation.x = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitchObject.rotation.x));
});

// Set camera position close to the ground for a first-person view (camera is child of pitchObject)
camera.position.set(0, 2.0, 0); // slightly above the grid

// Add a subtle ambient light for overall scene visibility
// Keep ambient relatively low so navigation lights are visible
const ambientLight = new THREE.AmbientLight(0x404040, 0.9); // soft white light
scene.add(ambientLight);

// Array to hold our custom plane objects
const planes = [];

// --- Plane Configuration ---
const MAX_PLANES = 10;

// List of available plane models
const PLANE_MODELS = [
    'B200_AFRC_AIR_0824.glb',
    'C130_WFF_AIR_0824.glb',
    'C20A_AFRC_AIR_0824.glb',
    'DC8_AFRC_AIR_0824.glb',
    'ER2_AFRC_AIR_0824.glb',
    'G3_JSC_AIR_0824.glb',
    'G4_NOAA_AIR_0824.glb',
    'HU25_LARC_AIR_0824.glb',
    'P3_WFF_AIR_0824.glb',
    'SIERRA_ARC_AIR_0824.glb',
    'TWIN_OTTER_CIRPAS_AIR_0824.glb',
    'WB57_JSC_AIR_0824.glb',
    'WP3D_N42RF_NOAA_AIR_0824.glb'
];
//manual edits to lights and planes
const PLANE_BASE_SCALE = 40.0;
const PLANE_LIGHT_OFFSET_SCALE = 0.01;
const NAV_LIGHT_SIZE = 0.005;
const STROBE_LIGHT_SIZE = 0.004;

// Baseline (unscaled) light attachment offsets relative to plane origin
const BASE_RED_LIGHT_POSITION = new THREE.Vector3(-0.5, 0, -1);
const BASE_GREEN_LIGHT_POSITION = new THREE.Vector3(0.5, 0, -1);
const BASE_WHITE_LIGHT_POSITIONS = [
    new THREE.Vector3(-0.5, 0, -1),
    new THREE.Vector3(0.5, 0, -1),
    new THREE.Vector3(0, 0, 1.5)
];

// Derive reasonable navigation light offsets based on model bounding box
function deriveLightOffsets(model) {
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.isEmpty()) {
        return null;
    }

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const wingSpan = size.x;
    const fuselageHeight = size.y;
    const fuselageLength = size.z;

    const minZ = bbox.min.z;
    const maxZ = bbox.max.z;
    const wingZReference = center.z - fuselageLength * 0.1;

    // Determine which end is the nose by proximity to the wing reference
    let noseZ = minZ;
    let tailZ = maxZ;
    if (Math.abs(maxZ - wingZReference) < Math.abs(minZ - wingZReference)) {
        noseZ = maxZ;
        tailZ = minZ;
    }

    const tailDirection = tailZ >= noseZ ? 1 : -1;
    const tailInset = fuselageLength * 0.05;
    const tailLightZ = tailZ - tailDirection * tailInset;

    // Place wing lights slightly ahead of fuselage center towards the nose
    const wingZ = noseZ + (tailZ - noseZ) * 0.25;
    const lightY = bbox.min.y + fuselageHeight * 0.6;

    const wingSpanFactorNav = 0.55;
    const wingSpanFactorStrobe = 0.5;

    const leftWing = new THREE.Vector3(center.x - wingSpan * wingSpanFactorNav, lightY, wingZ);
    const rightWing = new THREE.Vector3(center.x + wingSpan * wingSpanFactorNav, lightY, wingZ);

    const leftStrobe = new THREE.Vector3(center.x - wingSpan * wingSpanFactorStrobe, lightY, wingZ);
    const rightStrobe = new THREE.Vector3(center.x + wingSpan * wingSpanFactorStrobe, lightY, wingZ);
    const tailLight = new THREE.Vector3(center.x, lightY, tailLightZ);

    return {
        red: leftWing,
        green: rightWing,
        whites: [leftStrobe, rightStrobe, tailLight]
    };
}

// GLTF loader instance
const gltfLoader = new GLTFLoader();

// Cache for loaded models to avoid reloading
const modelCache = {};

// Normalize a loaded model so that:
// - Its lowest point sits at local Y = 0 (so floor proximity is consistent across models)
// - It is horizontally centered at local X/Z = 0
// Returns a new Object3D root with the model as a child
function normalizeModel(model) {
    // Ensure matrices are current
    model.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.isEmpty()) {
        const root = new THREE.Group();
        root.add(model);
        return root;
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    // Create a wrapper and reposition the model so that:
    // - X/Z center aligns to origin
    // - Y lowest point is at 0
    const root = new THREE.Group();
    // Shift amounts in world space; apply inverse to model's local position
    const shift = new THREE.Vector3(center.x, bbox.min.y, center.z);

    // Convert world shift to model parent's space (here root's local space = world since root at identity)
    model.position.sub(shift);
    root.add(model);

    // After reposition, update matrices
    root.updateMatrixWorld(true);
    return root;
}

// Function to load a GLB model asynchronously
async function loadPlaneModel(modelName) {
    if (modelCache[modelName]) {
        // Clone cached model
        return modelCache[modelName].clone();
    }
    
    try {
        const gltf = await new Promise((resolve, reject) => {
            gltfLoader.load(`/${modelName}`, resolve, undefined, reject);
        });
        
        const model = gltf.scene;
        // Cache the loaded gltf scene for future use
        modelCache[modelName] = gltf.scene.clone();
        
        return model;
    } catch (err) {
        console.error(`Failed to load plane model ${modelName}:`, err);
        // Fallback to placeholder if model fails to load
        const geometry = new THREE.BoxGeometry(1, 0.2, 3);
        const material = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.1 });
        return new THREE.Mesh(geometry, material);
    }
}

// Function to create plane geometry - easily swappable for 3D models
// Returns a Promise that resolves to the plane mesh (normalized wrapper)
async function createPlaneGeometry() {
    const randomModel = PLANE_MODELS[Math.floor(Math.random() * PLANE_MODELS.length)];
    const rawModel = await loadPlaneModel(randomModel);

    // Normalize the raw model into a root wrapper with consistent origin
    const model = normalizeModel(rawModel);

    // Apply global base scale to the normalized root so user can tune plane size
    model.scale.setScalar(PLANE_BASE_SCALE);

    // Ensure the model responds to lighting
    model.traverse((node) => {
        if (node.isMesh) {
            // Disable shadow casting on distant planes to save GPU performance
            // Only the closest 5-6 planes really need shadows
            node.castShadow = false;
            node.receiveShadow = false;
            
            // Optimize material properties
            if (node.material) {
                // Reduce roughness for faster rendering
                if (node.material.roughness !== undefined) {
                    node.material.roughness = Math.min(node.material.roughness, 0.8);
                }
                // Limit metalness to avoid expensive reflections
                if (node.material.metalness !== undefined) {
                    node.material.metalness = Math.min(node.material.metalness, 0.3);
                }
                // Cache material data to avoid recalculation
                node.material.needsUpdate = true;
            }
        }
    });
    // Update world matrices before measuring dimensions
    model.updateMatrixWorld(true);
    // Capture model-specific light attachment points on the normalized root
    const lightOffsets = deriveLightOffsets(model);
    if (lightOffsets) {
        // Store on userData so clones know where to attach lights
        model.userData.lightOffsets = {
            red: lightOffsets.red.clone(),
            green: lightOffsets.green.clone(),
            whites: lightOffsets.whites.map(v => v.clone())
        };
    }
    
    return model;
}

// Function to create a plane object with all components
async function createPlanePlaceholder(spawnNear = true, center = null) {
    // Create the main plane geometry/model (await the async loading)
    const planeMesh = await createPlaneGeometry();
    const lightOffsets = planeMesh.userData && planeMesh.userData.lightOffsets;

    // Per-plane performance characteristics for varied behavior
    const baseSpeedFactor = 0.75 + Math.random() * 0.6;
    const baseMinCruiseAltitude = Math.min(MAX_HEIGHT - 40, MIN_HEIGHT + 30 + Math.random() * 90);
    const climbPerformance = 0.8 + Math.random() * 0.6;
    const baseMaxClimbRate = 0.9 + Math.random() * 0.7;
    const baseMaxDescentRate = 0.4 + Math.random() * 0.5;
    const initialVSpeed = THREE.MathUtils.clamp(
        (Math.random() - 0.5) * (baseMaxClimbRate + baseMaxDescentRate),
        -baseMaxDescentRate,
        baseMaxClimbRate
    );
    const baseAltitudeCeiling = Math.min(
        MAX_HEIGHT - 20,
        baseMinCruiseAltitude + 120 + Math.random() * 120
    );
    let targetAltitude = THREE.MathUtils.clamp(
        baseMinCruiseAltitude + Math.random() * (baseAltitudeCeiling - baseMinCruiseAltitude),
        MIN_HEIGHT + 40,
        baseAltitudeCeiling
    );
    const initialAltitudeInterval = 15 + Math.random() * 20;

    // --- Navigation Lights ---
    // Red Light (e.g., left wing)
        const redLight = new THREE.PointLight(0xFF0000, 0, 60, 1.5); // Start off (intensity=0), modest range
        const baseRedOffset = lightOffsets && lightOffsets.red ? lightOffsets.red.clone() : BASE_RED_LIGHT_POSITION.clone();
        const redPosition = baseRedOffset.multiplyScalar(PLANE_LIGHT_OFFSET_SCALE);
        redLight.position.copy(redPosition);
    planeMesh.add(redLight);
    // visual indicator for the red nav light (so it's visible even on unlit materials)
    const redMesh = new THREE.Mesh(
        new THREE.SphereGeometry(NAV_LIGHT_SIZE, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xFF0000, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
    );
    redMesh.position.copy(redPosition);
    planeMesh.add(redMesh);
    // Add a helper and make the indicator larger for debugging
    let redHelper = null;
    if (DEBUG_LIGHTS) {
        redMesh.scale.setScalar(2.5);
        redMesh.material.opacity = 1;
        redHelper = new THREE.PointLightHelper(redLight, 1.2, 0xff0000);
        planeMesh.add(redHelper);
    }
    
    // Green Light (e.g., right wing)
    const greenLight = new THREE.PointLight(0x00FF00, 0, 60, 1.5); // Start off
    const baseGreenOffset = lightOffsets && lightOffsets.green ? lightOffsets.green.clone() : BASE_GREEN_LIGHT_POSITION.clone();
    const greenPosition = baseGreenOffset.multiplyScalar(PLANE_LIGHT_OFFSET_SCALE);
        greenLight.position.copy(greenPosition);
    planeMesh.add(greenLight);
    const greenMesh = new THREE.Mesh(
        new THREE.SphereGeometry(NAV_LIGHT_SIZE, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x00FF00, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
    );
    greenMesh.position.copy(greenPosition);
    planeMesh.add(greenMesh);
    let greenHelper = null;
    if (DEBUG_LIGHTS) {
        greenMesh.scale.setScalar(2.5);
        greenMesh.material.opacity = 1;
        greenHelper = new THREE.PointLightHelper(greenLight, 1.2, 0x00ff00);
        planeMesh.add(greenHelper);
    }

    // White Strobe Lights (left, right, back) - will blink together in a double-tap pattern
    const whiteLights = [];
    const whiteMeshes = [];
    const whiteHelpers = [];

    // Positions: left wing, right wing, tail/back
    const baseWhiteOffsets = (lightOffsets && lightOffsets.whites && lightOffsets.whites.length === 3)
        ? lightOffsets.whites.map(v => v.clone())
        : BASE_WHITE_LIGHT_POSITIONS.map(v => v.clone());
    const whitePositions = baseWhiteOffsets.map(pos => pos.multiplyScalar(PLANE_LIGHT_OFFSET_SCALE));

    for (let i = 0; i < whitePositions.length; i++) {
        const pos = whitePositions[i];
    const wLight = new THREE.PointLight(0xFFFFFF, 0, 80, 1.5); // start off
        wLight.position.copy(pos);
        planeMesh.add(wLight);
        whiteLights.push(wLight);

        const wMesh = new THREE.Mesh(
            new THREE.SphereGeometry(STROBE_LIGHT_SIZE, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
        );
        wMesh.position.copy(pos);
        planeMesh.add(wMesh);
        whiteMeshes.push(wMesh);

        let wHelper = null;
        if (DEBUG_LIGHTS) {
            wMesh.scale.setScalar(2.5);
            wMesh.material.opacity = 1;
            wHelper = new THREE.PointLightHelper(wLight, 1.6, 0xffffff);
            planeMesh.add(wHelper);
        }
        whiteHelpers.push(wHelper);
    }

    // --- Custom Plane Data ---
    const plane = {
        mesh: planeMesh,
        speed: 10,
        baseSpeed: baseSpeedFactor,
    minCruiseAltitude: baseMinCruiseAltitude,
        climbPerformance,
    maxClimbRate: baseMaxClimbRate,
    maxDescentRate: baseMaxDescentRate,
    altitudeCeiling: baseAltitudeCeiling,
    targetAltitude,
    altitudeTimer: 0,
    altitudeInterval: initialAltitudeInterval,
        baseScale: planeMesh.scale.clone(),
        redLight: redLight,
        greenLight: greenLight,
        whiteLights: whiteLights,
        redMesh: redMesh,
        greenMesh: greenMesh,
        whiteMeshes: whiteMeshes,
        redHelper,
        greenHelper,
        whiteHelpers,
        lightTimer: Math.random() * 50, // Random start time for flashing
        // vertical speed in units per second (positive = ascending)
        vSpeed: initialVSpeed,
    desiredClimbSmooth: initialVSpeed,
        
    // Physics: velocity vector and orientation
    velocity: new THREE.Vector3(0, 0, -1),  // direction of movement (normalized)
    heading: Math.random() * Math.PI * 2,   // yaw angle in radians
    pitch: 0,                                // start level; physics will adjust smoothly
    roll: 0,                                 // roll/bank angle (changes during turns)
        turnRate: (Math.random() - 0.5) * 0.4,  // degrees/sec for steering (slower, more purposeful)
        targetHeading: Math.random() * Math.PI * 2, // random target heading for flight path
        headingChangeTimer: 0,
    headingChangeInterval: 45 + Math.random() * 55  // change heading every 45-100 seconds
    };

    // Determine spawn center (camera world pos by default)
    const spawnCenter = center || (function(){ const p=new THREE.Vector3(); camera.getWorldPosition(p); return p; })();

    // Random initial position: spawn on the border of the chosen box (near or far)
    function pointOnBorder(center, size) {
        const half = size / 2;
        const side = Math.floor(Math.random() * 4);
        let x = center.x;
        let z = center.z;
        const rand = (Math.random() - 0.5) * size;
        switch (side) {
            case 0: // left
                x = center.x - half;
                z = center.z + rand;
                break;
            case 1: // right
                x = center.x + half;
                z = center.z + rand;
                break;
            case 2: // bottom
                x = center.x + rand;
                z = center.z - half;
                break;
            case 3: // top
                x = center.x + rand;
                z = center.z + half;
                break;
        }
        return { x, z };
    }

    if (spawnNear) {
        const p = pointOnBorder(spawnCenter, SPAWN_BOX_SIZE);
        planeMesh.position.x = p.x;
        planeMesh.position.z = p.z;
    } else {
        const p = pointOnBorder(spawnCenter, DESPAWN_BOX_SIZE);
        planeMesh.position.x = p.x;
        planeMesh.position.z = p.z;
    }
    const minCruise = plane.minCruiseAltitude || Math.min(MAX_HEIGHT - 40, MIN_HEIGHT + 30 + Math.random() * 90);
    plane.minCruiseAltitude = minCruise;
    const effectiveAltitudeCeiling = plane.altitudeCeiling || Math.min(MAX_HEIGHT - 20, minCruise + 120 + Math.random() * 120);
    plane.altitudeCeiling = effectiveAltitudeCeiling;
    // Spawn altitude: choose within a safe band far above the buffer and below the ceiling
    const respawnAltitude = computeSpawnAltitude(minCruise, effectiveAltitudeCeiling);
    plane.mesh.position.y = respawnAltitude;
    
    const spawnMaxClimb = plane.maxClimbRate || 1.2;
    const spawnMaxDescent = plane.maxDescentRate || 0.8;
    plane.vSpeed = THREE.MathUtils.clamp(
        (Math.random() - 0.5) * (spawnMaxClimb + spawnMaxDescent),
        -spawnMaxDescent,
        spawnMaxClimb
    );
    plane.desiredClimbSmooth = plane.vSpeed;
    // If we spawned close to the floor, bias vertical speed upward to avoid immediate descent
    if (plane.mesh.position.y < MIN_HEIGHT + NEAR_FLOOR_SPEED_BIAS_OFFSET) {
        plane.vSpeed = Math.max(plane.vSpeed, spawnMaxClimb * 0.6);
        plane.desiredClimbSmooth = plane.vSpeed;
    }
    plane.altitudeTimer = 0;
    plane.altitudeInterval = 15 + Math.random() * 20;
    plane.targetAltitude = THREE.MathUtils.clamp(
        minCruise + Math.random() * (plane.altitudeCeiling - minCruise),
        MIN_HEIGHT + 40,
        plane.altitudeCeiling
    );
    updatePlaneProperties(plane);

    scene.add(planeMesh);
    planes.push(plane);
}

function respawnPlane(plane, center = null) {
    const spawnCenter = center || (function(){ const p=new THREE.Vector3(); camera.getWorldPosition(p); return p; })();
    const spawnNear = Math.random() < SPAWN_NEAR_PROB;
    function pointOnBorder(center, size) {
        const half = size / 2;
        const side = Math.floor(Math.random() * 4);
        let x = center.x;
        let z = center.z;
        const rand = (Math.random() - 0.5) * size;
        switch (side) {
            case 0:
                x = center.x - half;
                z = center.z + rand;
                break;
            case 1:
                x = center.x + half;
                z = center.z + rand;
                break;
            case 2:
                x = center.x + rand;
                z = center.z - half;
                break;
            case 3:
                x = center.x + rand;
                z = center.z + half;
                break;
        }
        return { x, z };
    }
    if (spawnNear) {
        const p = pointOnBorder(spawnCenter, SPAWN_BOX_SIZE);
        plane.mesh.position.x = p.x;
        plane.mesh.position.z = p.z;
    } else {
        const p = pointOnBorder(spawnCenter, DESPAWN_BOX_SIZE);
        plane.mesh.position.x = p.x;
        plane.mesh.position.z = p.z;
    }
    const respawnAltitude2 = computeSpawnAltitude(
        plane.minCruiseAltitude || Math.min(MAX_HEIGHT - 40, MIN_HEIGHT + 60),
        plane.altitudeCeiling || Math.min(MAX_HEIGHT - 20, (plane.minCruiseAltitude || (MIN_HEIGHT + 60)) + 160)
    );
    plane.mesh.position.y = Math.min(respawnAltitude2, MAX_HEIGHT);
    plane.mesh.rotation.y = Math.random() * Math.PI * 2;
    const maxClimbRate = plane.maxClimbRate || 1.2;
    const maxDescentRate = plane.maxDescentRate || 0.8;
    const randomVSpeed = THREE.MathUtils.lerp(-maxDescentRate, maxClimbRate, Math.random());
    plane.vSpeed = randomVSpeed;
    plane.desiredClimbSmooth = plane.vSpeed;
    // If we respawned close to the floor, force a climb to ensure recovery
    if (plane.mesh.position.y < MIN_HEIGHT + NEAR_FLOOR_SPEED_BIAS_OFFSET) {
        plane.vSpeed = Math.max(plane.vSpeed, maxClimbRate * 0.6);
        plane.desiredClimbSmooth = plane.vSpeed;
    }
    plane.lightTimer = Math.random() * 50;
    
    // Reset physics on respawn
    plane.heading = plane.mesh.rotation.y;
    plane.pitch = 0; // start level on respawn; physics will introduce attitude gradually
    plane.roll = 0;
    plane.turnRate = (Math.random() - 0.5) * 0.4;
    plane.targetHeading = Math.random() * Math.PI * 2;
    plane.headingChangeTimer = 0;
    plane.headingChangeInterval = 45 + Math.random() * 55;
    
    updatePlaneProperties(plane);
}

// Function to adjust size and speed based on Y-position (height)
function updatePlaneProperties(plane) {
    const heightRatio = (plane.mesh.position.y - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);

    // Higher planes are faster; apply per-plane base speed multiplier for variation
    const baseSpeedFactor = plane.baseSpeed || 1;
    plane.speed = (0.05 + heightRatio * 0.15) * baseSpeedFactor; 

    // Higher planes are scaled up (to appear larger due to being closer to the camera at higher viewing angles)
    // A more realistic approach would be to scale them *down* as they get farther away, but since the 
    // camera is near the ground, higher planes are often visually *closer* in the typical viewing frustum.
    // For this effect, we'll keep the size roughly constant or slightly increase it to emphasize high altitude.
    const sizeScale = 1 + heightRatio * 1.5;
    let baseScale = plane.baseScale;
    if (!baseScale) {
        baseScale = plane.mesh.scale.clone();
        plane.baseScale = baseScale;
    }
    plane.mesh.scale.set(
        baseScale.x * sizeScale,
        baseScale.y * sizeScale,
        baseScale.z * sizeScale
    );
}

// Function to handle the flashing navigation lights
function flashNavigationLights(plane, time) {
    const speed = plane.speed * 20; // Flashing is related to speed

    // Red/Green Flash (Alternating/Fast)
    if (Math.sin(time * speed) > 0.8) {
    plane.redLight.intensity = DEBUG_LIGHTS ? 5 : 0.6;
        plane.greenLight.intensity = 0;
        if (plane.redMesh) plane.redMesh.material.opacity = 1;
        if (plane.redMesh) plane.redMesh.scale.setScalar(DEBUG_LIGHTS ? 3.0 : 1.0);
        if (plane.greenMesh) plane.greenMesh.material.opacity = 0;
    } else if (Math.sin(time * speed) < -0.8) {
        plane.redLight.intensity = 0;
    plane.greenLight.intensity = DEBUG_LIGHTS ? 5 : 0.6;
        if (plane.redMesh) plane.redMesh.material.opacity = 0;
        if (plane.greenMesh) plane.greenMesh.material.opacity = 1;
        if (plane.greenMesh) plane.greenMesh.scale.setScalar(DEBUG_LIGHTS ? 3.0 : 1.0);
    } else {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = 0;
        if (plane.redMesh) plane.redMesh.material.opacity = DEBUG_LIGHTS ? 0.6 : 0;
        if (plane.greenMesh) plane.greenMesh.material.opacity = DEBUG_LIGHTS ? 0.6 : 0;
    }

    // White Lights (Double-tap blink pattern: quick on, quick off, quick on, pause, repeat)
    // Durations in seconds
    const whiteOn = 0.08;
    const whiteGap = 0.2; // time between the two quick blinks
    const whitePause = 2; // pause after the double blink
    const whitePeriod = whiteOn * 2 + whiteGap + whitePause;
    const phase = time % whitePeriod;
    const isWhiteOn = (phase < whiteOn) || (phase >= (whiteOn + whiteGap) && phase < (whiteOn + whiteGap + whiteOn));

    if (plane.whiteLights && plane.whiteLights.length) {
        for (let i = 0; i < plane.whiteLights.length; i++) {
            const wl = plane.whiteLights[i];
            const wm = plane.whiteMeshes && plane.whiteMeshes[i];
            if (isWhiteOn) {
                wl.intensity = DEBUG_LIGHTS ? 7 : 1.6;
                if (wm) {
                    wm.material.opacity = 1;
                    wm.scale.setScalar(DEBUG_LIGHTS ? 3.5 : 1.0);
                }
            } else {
                wl.intensity = 0;
                if (wm) {
                    wm.material.opacity = DEBUG_LIGHTS ? 0.6 : 0;
                }
            }
        }
    }
}

// Initial plane generation
// Initial plane generation (bias spawn positions near camera)
for (let i = 0; i < MAX_PLANES; i++) {
    const spawnNear = Math.random() < SPAWN_NEAR_PROB;
    const center = (function(){ const p=new THREE.Vector3(); camera.getWorldPosition(p); return p; })();
    createPlanePlaceholder(spawnNear, center).catch(err => {
        console.error('Failed to create plane:', err);
    });
}

// --- Animation Loop ---
function animate(time) {
    requestAnimationFrame(animate);
    const dt = 1 / 60; // Assuming 60fps for simple physics/timing

    // --- Camera WASD movement (move the entire yawObject so camera moves with view direction) ---
    const moveSpeed = movement.speed * dt; // units per frame based on speed (units/sec)
    if (movement.forward || movement.backward || movement.left || movement.right || movement.up || movement.down) {
        // Get the forward direction from the yawObject (local Z direction after yaw rotation)
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(yawObject.quaternion);
        forward.y = 0; // ignore vertical component for horizontal movement
        forward.normalize();

        // Right vector (perpendicular to forward in horizontal plane)
        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const moveDir = new THREE.Vector3();
        if (movement.forward) moveDir.add(forward);
        if (movement.backward) moveDir.sub(forward);
        if (movement.left) moveDir.sub(right);
        if (movement.right) moveDir.add(right);
        if (movement.up) moveDir.y += 1;
        if (movement.down) moveDir.y -= 1;

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize().multiplyScalar(moveSpeed);
            yawObject.position.add(moveDir);
        }
    }

    // Keep the camera's Y position slightly above ground (2.0 units) so it doesn't clip below terrain
    if (yawObject.position.y < 2.0) yawObject.position.y = 2.0;

    // Prevent pitch and roll: keep camera local rotations at zero and allow only yaw on yawObject
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    yawObject.rotation.z = 0; // prevent roll

    // Keep the sky dome centered on the camera's world position so it appears infinite
    const camWorldPos = new THREE.Vector3();
    camera.getWorldPosition(camWorldPos);
    if (skyMesh) skyMesh.position.copy(camWorldPos);
    if (skyObjects) skyObjects.position.copy(camWorldPos);

    // Prepare frustum once per frame for culling
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    planes.forEach(plane => {
        // Frustum culling: skip rendering planes outside camera view (but still update physics)
        const planeBox = new THREE.Box3().setFromObject(plane.mesh);
        plane.mesh.visible = frustum.intersectsBox(planeBox);
        
        // Vertical movement and altitude management
        const altitude = plane.mesh.position.y;
        const maxClimbRate = plane.maxClimbRate || 1.2;
        const maxDescentRate = plane.maxDescentRate || 0.8;
        const climbPerformance = plane.climbPerformance || 1;
        const minCruiseAltitude = plane.minCruiseAltitude
            ? Math.min(plane.minCruiseAltitude, MAX_HEIGHT - 60)
            : MIN_HEIGHT + 75;
        const altitudeCeiling = plane.altitudeCeiling || Math.min(MAX_HEIGHT - 25, minCruiseAltitude + 180);

        // Initialize target altitude if not set
        if (!plane.targetAltitude) {
            plane.targetAltitude = Math.min(altitudeCeiling - 5, Math.max(minCruiseAltitude + 10, altitude + 25));
        }

        // Update target altitude periodically
        plane.altitudeTimer = (plane.altitudeTimer || 0) + dt;
        if (plane.altitudeTimer > (plane.altitudeInterval || 20)) {
            plane.altitudeTimer = 0;
            plane.altitudeInterval = 18 + Math.random() * 28;
            const newTarget = THREE.MathUtils.clamp(
                minCruiseAltitude + Math.random() * (altitudeCeiling - minCruiseAltitude),
                minCruiseAltitude + 10,
                altitudeCeiling
            );
            plane.targetAltitude = newTarget;
        }

        // Ensure target altitude stays within valid bounds (no contradictions)
        plane.targetAltitude = THREE.MathUtils.clamp(plane.targetAltitude, minCruiseAltitude + 5, altitudeCeiling - 5);

        const altitudeError = plane.targetAltitude - altitude;
        
        // Calculate bounding box to find the actual lowest point of the aircraft geometry
        const bbox = new THREE.Box3().setFromObject(plane.mesh);
        const lowestPointY = bbox.min.y;
        
        // --- Sophisticated Altitude Management ---
        // Calculate proximity to floor and ceiling (0..1, where 1 = at limit)
    const floorBuffer = MIN_HEIGHT + FLOOR_BUFFER;
        const floorProximity = THREE.MathUtils.clamp(
            1 - (lowestPointY - MIN_HEIGHT) / (floorBuffer - MIN_HEIGHT),
            0, 1
        );
        const ceilingProximity = THREE.MathUtils.clamp(
            1 - (altitudeCeiling - altitude) / (altitudeCeiling - minCruiseAltitude),
            0, 1
        );
        
        // Calculate descent/ascent angle from current vertical speed
        const horizontalSpeed = plane.speed || 0.1;
        const descentAngle = Math.atan2(plane.vSpeed || 0, horizontalSpeed);
        
        // Base desired climb from altitude error
        let baseDesiredClimb = altitudeError * 0.06 * climbPerformance;
        
        // Adjust climb rate based on proximity to limits
        let adjustedDesiredClimb = baseDesiredClimb;
        
        // Near floor: smoothly raise the minimum allowed climb and add a gentle recovery boost
        if (floorProximity > 0) {
            const floorBlend = Math.pow(floorProximity, 1.6);
            const minAllowedClimb = THREE.MathUtils.lerp(-maxDescentRate, maxClimbRate * 0.45, floorBlend);
            adjustedDesiredClimb = Math.max(adjustedDesiredClimb, minAllowedClimb);
            adjustedDesiredClimb += floorBlend * floorBlend * maxClimbRate * 0.3;
        }
        
        // Near ceiling: gradually limit climb rate instead of a hard cutoff
        if (ceilingProximity > 0) {
            const ceilingBlend = Math.pow(ceilingProximity, 1.6);
            const maxAllowedClimb = THREE.MathUtils.lerp(maxClimbRate, -maxDescentRate * 0.4, ceilingBlend);
            adjustedDesiredClimb = Math.min(adjustedDesiredClimb, maxAllowedClimb);
        }
        
        // Clamp to plane's performance limits
        let desiredClimb = THREE.MathUtils.clamp(
            adjustedDesiredClimb,
            -maxDescentRate,
            maxClimbRate
        );
        
        const desiredClimbSmooth = plane.desiredClimbSmooth !== undefined
            ? THREE.MathUtils.lerp(plane.desiredClimbSmooth, desiredClimb, 0.2)
            : desiredClimb;
        plane.desiredClimbSmooth = desiredClimbSmooth;
        
        plane.altitudeError = altitudeError;
        plane.lastDesiredClimb = desiredClimbSmooth;
        plane.floorProximity = floorProximity;
        plane.ceilingProximity = ceilingProximity;
        plane.descentAngle = descentAngle;

        plane.vSpeed = THREE.MathUtils.lerp(plane.vSpeed || 0, desiredClimbSmooth, 0.08);

        plane.mesh.position.y += plane.vSpeed * dt;

        if (plane.mesh.position.y > altitudeCeiling) {
            plane.mesh.position.y = altitudeCeiling;
            plane.vSpeed = Math.min(plane.vSpeed, 0);
            plane.targetAltitude = Math.max(minCruiseAltitude + 20, altitudeCeiling - 15);
        } else if (plane.mesh.position.y < MIN_HEIGHT + FLOOR_CLAMP_OFFSET) {
            plane.mesh.position.y = MIN_HEIGHT + FLOOR_CLAMP_OFFSET;
            const climbKick = maxClimbRate * 0.35;
            plane.vSpeed = Math.max(plane.vSpeed, climbKick); // Prevent downward motion at floor
            plane.desiredClimbSmooth = Math.max(plane.desiredClimbSmooth || 0, climbKick);
            plane.targetAltitude = Math.max(
                plane.targetAltitude || (MIN_HEIGHT + FLOOR_BUFFER + 30),
                MIN_HEIGHT + FLOOR_BUFFER + 30,
                minCruiseAltitude + 20
            );
        }
        // Update properties after vertical change
        updatePlaneProperties(plane);

        // --- Realistic Plane Physics ---
        // Heading change: set target heading less frequently (every 20-60 seconds) for purposeful flight
        plane.headingChangeTimer += dt;
        if (plane.headingChangeTimer > plane.headingChangeInterval) {
            // Small random deviation from current heading for wind-like behavior
            const deviation = (Math.random() - 0.5) * 0.35; // ±20 degrees max
            plane.targetHeading = plane.heading + deviation;
            plane.headingChangeInterval = 45 + Math.random() * 55; // next change in 45-100 seconds
            plane.headingChangeTimer = 0;
        }

        // Smooth heading change: interpolate towards target
        let headingDiff = plane.targetHeading - plane.heading;
        // Wrap difference to [-π, π]
        while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
        while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
        
        // Gradually turn towards target - much slower and more graceful
        const headingChangeRate = 0.18; // radians per second (slower, sweeping turns)
        const maxTurnThisFrame = headingChangeRate * dt;
        plane.heading += Math.max(-maxTurnThisFrame, Math.min(maxTurnThisFrame, headingDiff * 0.12));

        // Banking/roll effect: bank into turns (roll angle follows heading change rate)
    const targetRoll = THREE.MathUtils.clamp(-headingDiff * 0.6, -Math.PI / 5, Math.PI / 5);
        plane.roll += (targetRoll - plane.roll) * 0.03; // slower, more graceful roll response
        plane.roll = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, plane.roll)); // clamp roll to ±45°

        // Dynamic pitch: respond to climb/descent physics with smooth transitions
        const desiredClimbRate = plane.lastDesiredClimb !== undefined ? plane.lastDesiredClimb : (plane.vSpeed || 0);
        const climbRateDiff = (plane.vSpeed || 0) - desiredClimbRate;
        
        // Pitch influenced by: desired climb rate (primary), climb error (secondary), altitude error (tertiary)
        // All influences are damped for smooth, gradual changes
        const targetPitch = THREE.MathUtils.clamp(
            desiredClimbRate * 0.4
            - climbRateDiff * 0.15
            + ((plane.altitudeError || 0) / 200) * 0.08
            + ((plane.floorProximity || 0) * 0.12), // nose-up bias near the floor
            -Math.PI / 5,
            Math.PI / 5
        );
        
        // Very smooth pitch transition: 0.035 ensures gradual changes even with large target differences
        plane.pitch = THREE.MathUtils.lerp(plane.pitch, targetPitch, 0.035);
        plane.pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, plane.pitch)); // clamp pitch to ±45°

        // Update plane orientation (heading, pitch, roll)
        plane.mesh.rotation.order = 'YXZ'; // Euler order: yaw, pitch, roll
        plane.mesh.rotation.y = plane.heading;   // yaw
        plane.mesh.rotation.x = plane.pitch;     // pitch
        plane.mesh.rotation.z = plane.roll;      // roll (banking)

        // Move plane forward in its local Z direction (based on speed)
        plane.mesh.translateZ(plane.speed);

        // 2. Despawn/respawn: if plane is outside the despawn bounding box around the camera, respawn it
        const despawnHalf = DESPAWN_BOX_SIZE / 2;
        if (Math.abs(plane.mesh.position.x - camWorldPos.x) > despawnHalf ||
            Math.abs(plane.mesh.position.z - camWorldPos.z) > despawnHalf) {
            respawnPlane(plane, camWorldPos);
            return; // continue to next plane
        }

        // 3. Navigation Lights Flashing
        plane.lightTimer += dt;
        flashNavigationLights(plane, plane.lightTimer);
    });

    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate(0); // Start the loop