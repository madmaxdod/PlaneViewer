// Use bare imports so Vite (or another bundler/dev server) resolves the package from
// node_modules. This avoids browser errors like "Failed to resolve module specifier 'three'".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './style.css';

// Debug flags
const DEBUG_LIGHTS = false;
const DEBUG_HUD = false; // Show on-screen debug info for nearest plane
const DEBUG_CONSOLE = false; // Log spawn/altitude events to console
// Global plane speed multiplier (set >1 to speed up planes for debugging)

// Loading screen management
let planesLoaded = 0;
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.querySelector('.loading-text');
const DEBUG_PLANE_SPEED_MULT = 3; // e.g., 8x faster; set to 1 for normal
// Camera movement speed multiplier for debug mode
const DEBUG_CAMERA_SPEED_MULT = 4; // 4x faster camera in debug mode; set to 1 for normal

// --- Global Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });

// Optimize rendering for performance while scaling planes
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for performance
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Day/Night Cycle Configuration
let timeOfDay = 0.25; // 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1.0 = midnight
const DAY_CYCLE_SPEED = 0.001; // How fast time progresses (0.01 = ~100 seconds per full cycle)
let nightModeOnly = false; // When true, stays at night (timeOfDay = 0)

// Atmospheric Haze/Fog Configuration
const FOG_NEAR = 500;  // Distance where fog starts to appear
const FOG_FAR = 1200;   // Distance where fog is at maximum density (before spawn area)

// Wind System Configuration
let windDirection = Math.random() * Math.PI * 2; // Global wind direction (radians)
let windStrength = 0.5 + Math.random() * 1.5; // Wind strength (0.5-2.0)
let windChangeTimer = 0;
const WIND_CHANGE_INTERVAL = 60; // Change wind every 60 seconds
const TURBULENCE_FREQUENCY = 0.3; // How often turbulence affects each plane

// Set initial background (will be updated by day/night cycle)
scene.background = new THREE.Color(0x02001A);
// Initialize fog (color will be updated with day/night cycle)
scene.fog = new THREE.Fog(0x02001A, FOG_NEAR, FOG_FAR);
renderer.setSize(window.innerWidth, window.innerHeight);
// Attach canvas to the #app container if present to avoid layout/CSS conflicts
const appRoot = document.getElementById('app');
(appRoot || document.body).appendChild(renderer.domElement);

// Create a green "grass" ground using chunked tiles so terrain streams as you move.
// We'll generate a small canvas texture with a green gradient and subtle blade strokes,
// then tile it over chunk meshes that load/unload around the camera.
const CHUNK_SIZE = 2000;     // world tile size in units (X/Z) - larger to extend beyond fog
const CHUNK_RADIUS = 1;      // how many tiles around the current to keep loaded (1 => 3x3 grid = 6km coverage)
// Ground height (where the grid lies) - this is the REFERENCE POINT (Y=0 in world space)
const GROUND_HEIGHT = 0;

// --- Altitude Limits: ALL VALUES ARE HEIGHT ABOVE GROUND (AGL) ---
// To get absolute Y position, add GROUND_HEIGHT (which is 0, so AGL = absolute Y)
const MIN_HEIGHT_AGL = 50;   // Reference floor (meters AGL)
const MAX_HEIGHT_AGL = 800;  // Reference ceiling (meters AGL) - very high to give lots of room
const FLOOR_AVOIDANCE_DIST = 150;  // Wide danger zone - start pushing up when within this distance of floor
const CEILING_AVOIDANCE_DIST = 150; // Wide danger zone - start pushing down when within this distance of ceiling

// Helper to convert AGL to absolute Y (though since GROUND_HEIGHT=0, they're the same)
const aglToY = (agl) => GROUND_HEIGHT + agl;
const yToAGL = (y) => y - GROUND_HEIGHT;

// Define safe zone for all operations (well away from floor/ceiling limits)
const SAFE_ZONE_MIN = MIN_HEIGHT_AGL + FLOOR_AVOIDANCE_DIST + 50; // 250m (50 + 150 + 50)
const SAFE_ZONE_MAX = MAX_HEIGHT_AGL - CEILING_AVOIDANCE_DIST - 50; // 600m (800 - 150 - 50)

// Compute a safe spawn altitude (always in safe zone)
function computeSpawnAltitude() {
    const altitude = SAFE_ZONE_MIN + Math.random() * (SAFE_ZONE_MAX - SAFE_ZONE_MIN);
    return aglToY(altitude); // Convert to absolute Y position (170-240m)
}

// --- Waypoint System ---
const WAYPOINT_DISTANCE_MIN = 800;  // Minimum distance from plane to waypoint
const WAYPOINT_DISTANCE_MAX = 1500; // Maximum distance from plane to waypoint

// Generate a waypoint far from the plane's current position
function generateWaypoint(planePos) {
    const distance = WAYPOINT_DISTANCE_MIN + Math.random() * (WAYPOINT_DISTANCE_MAX - WAYPOINT_DISTANCE_MIN);
    const angle = Math.random() * Math.PI * 2; // Random horizontal direction
    const altitude = SAFE_ZONE_MIN + Math.random() * (SAFE_ZONE_MAX - SAFE_ZONE_MIN);
    
    return new THREE.Vector3(
        planePos.x + Math.cos(angle) * distance,
        aglToY(altitude),
        planePos.z + Math.sin(angle) * distance
    );
}

// Spawn/despawn bounding boxes (sizes)
const DESPAWN_BOX_SIZE = CHUNK_SIZE * 3; // beyond this box planes will be respawned (3000m)
const SPAWN_DISTANCE_MIN = 1200; // minimum distance from viewer to spawn (well beyond fog)
const SPAWN_DISTANCE_MAX = 1800; // maximum distance from viewer to spawn

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
grassTexture.repeat.set(CHUNK_SIZE / 64, CHUNK_SIZE / 64);

const groundMat = new THREE.MeshStandardMaterial({ 
    map: grassTexture,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide
});
// --- Terrain Chunk Manager ---
class TerrainChunkManager {
    constructor(scene, material) {
        this.scene = scene;
        this.material = material;
        // Share a single geometry across all tiles for perf
        this.geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
        this.active = new Map(); // key -> mesh
        this.centerCx = null;
        this.centerCz = null;
    }

    key(cx, cz) { return `${cx},${cz}`; }

    ensureChunk(cx, cz) {
        const k = this.key(cx, cz);
        if (this.active.has(k)) return;
        const mesh = new THREE.Mesh(this.geometry, this.material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(cx * CHUNK_SIZE, GROUND_HEIGHT - 0.01, cz * CHUNK_SIZE);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.active.set(k, mesh);
    }

    update(centerPos) {
        const cx = Math.floor(centerPos.x / CHUNK_SIZE);
        const cz = Math.floor(centerPos.z / CHUNK_SIZE);
        if (cx === this.centerCx && cz === this.centerCz && this.active.size > 0) return; // no tile crossing
        this.centerCx = cx; this.centerCz = cz;

        // Desired set of chunks
        const needed = new Set();
        for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
            for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
                const x = cx + dx;
                const z = cz + dz;
                const k = this.key(x, z);
                needed.add(k);
                this.ensureChunk(x, z);
            }
        }

        // Remove chunks that are no longer needed (behind you)
        for (const [k, mesh] of this.active) {
            if (!needed.has(k)) {
                this.scene.remove(mesh);
                mesh.geometry = null; // geometry is shared - don't dispose here
                // keep material shared; do not dispose
                this.active.delete(k);
            }
        }
    }
}

const terrainChunks = new TerrainChunkManager(scene, groundMat);



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
        groundHeight: { value: GROUND_HEIGHT },
        timeOfDay: { value: timeOfDay },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) }
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
        uniform float timeOfDay;
        uniform vec3 sunDirection;
        
        void main() {
            // Smooth step to blend the sky in above the ground
            float h = smoothstep(groundHeight, groundHeight + 40.0, vWorldPos.y);
            
            // Calculate sun influence for sky colors
            vec3 viewDir = normalize(vWorldPos);
            float sunDot = dot(viewDir, sunDirection);
            float sunInfluence = smoothstep(-0.1, 0.3, sunDot);
            
            // Define sky colors for different times of day
            vec3 nightTopColor = vec3(0.01, 0.03, 0.12);
            vec3 nightHorizonColor = vec3(0.02, 0.06, 0.18);
            
            vec3 dayTopColor = vec3(0.3, 0.5, 0.9);
            vec3 dayHorizonColor = vec3(0.6, 0.7, 0.9);
            
            vec3 sunsetTopColor = vec3(0.2, 0.3, 0.6);
            vec3 sunsetHorizonColor = vec3(1.0, 0.5, 0.3);
            
            // Determine day phase (0 = night, 0.5 = sunrise/sunset, 1 = day)
            float dayPhase = smoothstep(0.15, 0.35, timeOfDay) - smoothstep(0.65, 0.85, timeOfDay);
            
            // Determine sunset phase
            float sunsetPhase = smoothstep(0.1, 0.25, timeOfDay) * (1.0 - smoothstep(0.25, 0.35, timeOfDay))
                              + smoothstep(0.65, 0.75, timeOfDay) * (1.0 - smoothstep(0.75, 0.9, timeOfDay));
            
            // Mix colors based on time of day
            vec3 topColor = mix(nightTopColor, dayTopColor, dayPhase);
            topColor = mix(topColor, sunsetTopColor, sunsetPhase);
            
            vec3 horizonColor = mix(nightHorizonColor, dayHorizonColor, dayPhase);
            horizonColor = mix(horizonColor, sunsetHorizonColor, sunsetPhase);
            
            // Add sun glow at horizon
            horizonColor += vec3(1.0, 0.8, 0.5) * sunInfluence * dayPhase * 0.5;
            
            // Gradient from horizon to top
            float gradientFactor = clamp((vWorldPos.y - groundHeight) / 400.0, 0.0, 1.0);
            vec3 color = mix(horizonColor, topColor, gradientFactor);

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

// --- Celestial Objects (Sun, Moon, Stars) ---
const skyObjects = new THREE.Group();
scene.add(skyObjects);

const celestialObjects = {
    stars: [],
    moon: null,
    moonLight: null,
    sun: null,
    sunLight: null
};

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
        celestialObjects.stars.push(star);
    }
}

function createMoon() {
    const moonRadius = 50;
    const moonGeo = new THREE.SphereGeometry(moonRadius, 32, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xf6f3e1, transparent: true });
    moonMat.depthTest = false;
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.renderOrder = 1000;
    skyObjects.add(moon);
    celestialObjects.moon = moon;

    // add a gentle point light for the moon
    const moonLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    scene.add(moonLight);
    celestialObjects.moonLight = moonLight;
}

function createSun() {
    const sunRadius = 60;
    const sunGeo = new THREE.SphereGeometry(sunRadius, 32, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true });
    sunMat.depthTest = false;
    const sun = new THREE.Mesh(sunGeo, sunMat);
    sun.renderOrder = 1000;
    skyObjects.add(sun);
    celestialObjects.sun = sun;

    // add a directional light for the sun
    const sunLight = new THREE.DirectionalLight(0xffffee, 1.5);
    scene.add(sunLight);
    celestialObjects.sunLight = sunLight;
}

createStars(240);
createMoon();
createSun();

// (camera position set after parenting below)

// Use pointer lock so the user can click to look around (mouse movement rotates view).
// We keep the camera position on the ground (y fixed) and only allow rotation.
// We'll create a yaw object and parent the camera to it. We'll rotate the yawObject
// on pointer movement's X axis only. The camera's local rotation/pitch/roll will be
// kept at zero so there's no pitch or roll.
const yawObject = new THREE.Object3D();
// Start at the center of a chunk (CHUNK_SIZE / 2)
yawObject.position.set(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2);
// pitchObject will handle up/down rotation; camera remains child of pitchObject
const pitchObject = new THREE.Object3D();
pitchObject.add(camera);
yawObject.add(pitchObject);
scene.add(yawObject);

// Initialize terrain chunks around the starting position
if (typeof terrainChunks !== 'undefined') {
    terrainChunks.update(yawObject.position);
}

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
    speed: 20 // units per second (normal ground movement speed - slower for realism)
};

// UI update function for night mode toggle
function updateNightModeUI() {
    const btn = document.getElementById('night-mode-toggle');
    if (btn) {
        btn.classList.toggle('active', nightModeOnly);
        btn.textContent = nightModeOnly ? '🌙 Night Mode: ON' : '🌙 Night Mode: OFF';
    }
}

// Map keys to movement flags
function onKeyDown(event) {
    // Toggle night mode with 'N' key
    if (event.key.toLowerCase() === 'n') {
        nightModeOnly = !nightModeOnly;
        updateNightModeUI();
        event.preventDefault();
        return;
    }
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

// --- Night Mode Button Handler ---
const nightModeBtn = document.getElementById('night-mode-toggle');
if (nightModeBtn) {
    nightModeBtn.addEventListener('click', () => {
        nightModeOnly = !nightModeOnly;
        updateNightModeUI();
    });
}

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

// --- Debug HUD ---
let debugHUD = null;
if (DEBUG_HUD) {
    debugHUD = document.createElement('div');
    Object.assign(debugHUD.style, {
        position: 'absolute',
        left: '12px',
        top: '80px',
        padding: '10px 14px',
        background: 'rgba(0,0,0,0.75)',
        color: '#0f0',
        border: '1px solid rgba(0,255,0,0.3)',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '11px',
        lineHeight: '1.5',
        zIndex: '9998',
        minWidth: '280px',
        backdropFilter: 'blur(4px)'
    });
    debugHUD.innerHTML = 'Debug: Initializing...';
    document.body.appendChild(debugHUD);
}

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
    new THREE.Vector3(0, 0, -3)
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
    try {
        // Create the main plane geometry/model (await the async loading)
        const planeMesh = await createPlaneGeometry();
        if (!planeMesh) {
            throw new Error('createPlaneGeometry returned null/undefined');
        }
        const lightOffsets = planeMesh.userData && planeMesh.userData.lightOffsets;

    // Per-plane performance characteristics for varied behavior
    const baseSpeedFactor = 0.75 + Math.random() * 0.6;
    const climbPerformance = 0.8 + Math.random() * 0.6;
    const baseMaxClimbRate = 0.9 + Math.random() * 0.7;
    const baseMaxDescentRate = 0.4 + Math.random() * 0.5;
    
    // Spawn with level or slight climb to avoid immediate nosedive
    const initialVSpeed = THREE.MathUtils.clamp(
        Math.random() * baseMaxClimbRate * 0.5, // 0 to 50% of max climb (never negative at spawn)
        0,
        baseMaxClimbRate
    );
    
    const initialWaypointInterval = 30 + Math.random() * 40; // Time before first waypoint change (30-70s)
    
    if (DEBUG_CONSOLE) {
        console.log('🛫 Creating plane:', {
            initialVSpeed: initialVSpeed.toFixed(2),
            maxClimb: baseMaxClimbRate.toFixed(2),
            maxDescent: baseMaxDescentRate.toFixed(2)
        });
    }

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
        climbPerformance,
        maxClimbRate: baseMaxClimbRate,
        maxDescentRate: baseMaxDescentRate,
        waypoint: null, // Will be set after position is determined
        waypointTimer: 0,
        waypointInterval: initialWaypointInterval,
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
        headingChangeInterval: 45 + Math.random() * 55,  // change heading every 45-100 seconds
        
        // Wind effects
        turbulenceTimer: Math.random() * 10, // Random start for turbulence
        turbulenceOffset: new THREE.Vector3(0, 0, 0), // Current turbulence displacement
        windDrift: new THREE.Vector3(0, 0, 0) // Accumulated wind drift
    };

    // Determine spawn center (camera world pos by default)
    const spawnCenter = center || (function(){ const p=new THREE.Vector3(); camera.getWorldPosition(p); return p; })();

    // Spawn at a random distance away from viewer (not on visible borders)
    const spawnDistance = SPAWN_DISTANCE_MIN + Math.random() * (SPAWN_DISTANCE_MAX - SPAWN_DISTANCE_MIN);
    const spawnAngle = Math.random() * Math.PI * 2; // random direction
    
    planeMesh.position.x = spawnCenter.x + Math.cos(spawnAngle) * spawnDistance;
    planeMesh.position.z = spawnCenter.z + Math.sin(spawnAngle) * spawnDistance;
    
    // Set spawn altitude using simplified function
    plane.mesh.position.y = computeSpawnAltitude();
    
    // Set initial vSpeed (already set above in plane creation)
    plane.vSpeed = initialVSpeed;
    plane.desiredClimbSmooth = initialVSpeed;
    
    // Generate initial waypoint after position is set
    plane.waypoint = generateWaypoint(planeMesh.position);
    
    updatePlaneProperties(plane);

    scene.add(planeMesh);
    planes.push(plane);
    } catch (error) {
        console.error('❌ Error in createPlanePlaceholder:', error);
        throw error; // Re-throw to be caught by caller
    }
}

function respawnPlane(plane, center = null) {
    const spawnCenter = center || (function(){ const p=new THREE.Vector3(); camera.getWorldPosition(p); return p; })();
    
    // Spawn at a random distance away from viewer (not on visible borders)
    const spawnDistance = SPAWN_DISTANCE_MIN + Math.random() * (SPAWN_DISTANCE_MAX - SPAWN_DISTANCE_MIN);
    const spawnAngle = Math.random() * Math.PI * 2; // random direction
    
    plane.mesh.position.x = spawnCenter.x + Math.cos(spawnAngle) * spawnDistance;
    plane.mesh.position.z = spawnCenter.z + Math.sin(spawnAngle) * spawnDistance;
    
    // Respawn at safe altitude
    plane.mesh.position.y = computeSpawnAltitude();
    plane.mesh.rotation.y = Math.random() * Math.PI * 2;
    
    const maxClimbRate = plane.maxClimbRate || 1.2;
    const maxDescentRate = plane.maxDescentRate || 0.8;
    
    // Respawn with level or slight climb to avoid nosedive
    const randomVSpeed = THREE.MathUtils.clamp(
        Math.random() * maxClimbRate * 0.5, // 0 to 50% of max climb
        0,
        maxClimbRate
    );
    plane.vSpeed = randomVSpeed;
    plane.desiredClimbSmooth = plane.vSpeed;
    plane.lightTimer = Math.random() * 50;
    
    // Generate new waypoint for respawned plane
    plane.waypoint = generateWaypoint(plane.mesh.position);
    
    if (DEBUG_CONSOLE) {
        console.log('🔄 Respawning plane at:', {
            altitude: plane.mesh.position.y.toFixed(1),
            vSpeed: plane.vSpeed.toFixed(2),
            waypoint: `(${plane.waypoint.x.toFixed(0)}, ${plane.waypoint.y.toFixed(0)}, ${plane.waypoint.z.toFixed(0)})`
        });
    }
    
    // Reset physics on respawn
    plane.heading = plane.mesh.rotation.y;
    plane.pitch = 0; // start level on respawn; physics will introduce attitude gradually
    plane.roll = 0;
    plane.turnRate = (Math.random() - 0.5) * 0.4;
    plane.headingChangeTimer = 0;
    plane.headingChangeInterval = 45 + Math.random() * 55;
    
    updatePlaneProperties(plane);
}

// Function to adjust size and speed based on height above ground
function updatePlaneProperties(plane) {
    const agl = yToAGL(plane.mesh.position.y);
    const heightRatio = (agl - MIN_HEIGHT_AGL) / (MAX_HEIGHT_AGL - MIN_HEIGHT_AGL);

    // Higher planes are faster; apply per-plane base speed multiplier for variation
    const baseSpeedFactor = plane.baseSpeed || 1;
    plane.speed = (0.05 + heightRatio * 0.15) * baseSpeedFactor * DEBUG_PLANE_SPEED_MULT; 

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
function flashNavigationLights(plane, time, lightMultiplier = 1.0) {
    const speed = plane.speed * 20; // Flashing is related to speed

    // Calculate base intensities adjusted for time of day
    // Lights are brighter at night (multiplier high) and dimmer during day (multiplier low)
    const redGreenBase = DEBUG_LIGHTS ? 10 : 1.2; // 2x brighter (was 5 / 0.6)
    const whiteBase = DEBUG_LIGHTS ? 14 : 3.2; // 2x brighter (was 7 / 1.6)
    
    const redGreenIntensity = redGreenBase * lightMultiplier;
    const whiteIntensity = whiteBase * lightMultiplier;

    // Red/Green Flash (Alternating/Fast)
    if (Math.sin(time * speed) > 0.8) {
        plane.redLight.intensity = redGreenIntensity;
        plane.greenLight.intensity = 0;
        if (plane.redMesh) plane.redMesh.material.opacity = lightMultiplier;
        if (plane.redMesh) plane.redMesh.scale.setScalar(DEBUG_LIGHTS ? 3.0 : 1.0);
        if (plane.greenMesh) plane.greenMesh.material.opacity = 0;
    } else if (Math.sin(time * speed) < -0.8) {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = redGreenIntensity;
        if (plane.redMesh) plane.redMesh.material.opacity = 0;
        if (plane.greenMesh) plane.greenMesh.material.opacity = lightMultiplier;
        if (plane.greenMesh) plane.greenMesh.scale.setScalar(DEBUG_LIGHTS ? 3.0 : 1.0);
    } else {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = 0;
        if (plane.redMesh) plane.redMesh.material.opacity = DEBUG_LIGHTS ? 0.6 * lightMultiplier : 0;
        if (plane.greenMesh) plane.greenMesh.material.opacity = DEBUG_LIGHTS ? 0.6 * lightMultiplier : 0;
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
                wl.intensity = whiteIntensity;
                if (wm) {
                    wm.material.opacity = lightMultiplier;
                    wm.scale.setScalar(DEBUG_LIGHTS ? 3.5 : 1.0);
                }
            } else {
                wl.intensity = 0;
                if (wm) {
                    wm.material.opacity = DEBUG_LIGHTS ? 0.6 * lightMultiplier : 0;
                }
            }
        }
    }
}

// Function to hide loading screen
function hideLoadingScreen() {
    if (loadingScreen) {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 800); // Match CSS transition time
    }
}

// Initial plane generation
if (DEBUG_CONSOLE) console.log(`🚀 Starting to create ${MAX_PLANES} planes...`);
for (let i = 0; i < MAX_PLANES; i++) {
    const center = (function(){ const p=new THREE.Vector3(); camera.getWorldPosition(p); return p; })();
    createPlanePlaceholder(true, center).then(() => {
        planesLoaded++;
        if (DEBUG_CONSOLE) console.log(`✅ Plane ${i + 1}/${MAX_PLANES} created. Total: ${planes.length}`);
        
        // Hide loading screen once all planes are loaded
        if (planesLoaded >= MAX_PLANES) {
            setTimeout(() => {
                hideLoadingScreen();
                if (DEBUG_CONSOLE) console.log('🎉 All planes loaded, hiding loading screen');
            }, 300); // Small delay for smoother transition
        }
    }).catch(err => {
        console.error(`❌ Failed to create plane ${i + 1}:`, err);
        planesLoaded++; // Count failed loads too
        if (planesLoaded >= MAX_PLANES) {
            hideLoadingScreen();
        }
    });
}
if (DEBUG_CONSOLE) console.log(`📡 Plane creation initiated. Planes array length: ${planes.length}`);

// --- Day/Night Cycle Update Function ---
function updateDayNightCycle() {
    // Calculate sun and moon positions based on time of day
    // timeOfDay: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1.0 = midnight
    
    const celestialDistance = SKY_RADIUS * 0.85;
    
    // Sun angle: rises at 0.25, peaks at 0.5, sets at 0.75
    // Map timeOfDay to sun angle: 0.25 -> -90°, 0.5 -> 0°, 0.75 -> 90°
    const sunAngle = (timeOfDay - 0.5) * Math.PI * 2; // Full rotation
    const sunY = Math.sin(sunAngle) * celestialDistance;
    const sunZ = Math.cos(sunAngle) * celestialDistance;
    
    // Moon is opposite to the sun
    const moonAngle = sunAngle + Math.PI;
    const moonY = Math.sin(moonAngle) * celestialDistance;
    const moonZ = Math.cos(moonAngle) * celestialDistance;
    
    // Update sun position and visibility
    if (celestialObjects.sun) {
        celestialObjects.sun.position.set(0, sunY, sunZ);
        // Sun is visible during day AND above horizon
        const sunVisible = (timeOfDay > 0.15 && timeOfDay < 0.85) && sunY > 0;
        celestialObjects.sun.visible = sunVisible;
        celestialObjects.sun.material.opacity = sunVisible ? 1.0 : 0.0;
    }
    
    // Update moon position and visibility
    if (celestialObjects.moon) {
        celestialObjects.moon.position.set(0, moonY, moonZ);
        // Moon is visible during night AND above horizon
        const moonVisible = (timeOfDay < 0.15 || timeOfDay > 0.85) && moonY > 0;
        celestialObjects.moon.visible = moonVisible;
        celestialObjects.moon.material.opacity = moonVisible ? 1.0 : 0.0;
    }
    
    // Update sun light
    if (celestialObjects.sunLight) {
        celestialObjects.sunLight.position.set(0, sunY, sunZ);
        // Sun light intensity peaks at noon
        const dayPhase = Math.max(0, Math.sin((timeOfDay - 0.25) * Math.PI * 2));
        celestialObjects.sunLight.intensity = dayPhase * 1.5;
    }
    
    // Update moon light
    if (celestialObjects.moonLight) {
        celestialObjects.moonLight.position.set(0, moonY, moonZ);
        // Moon light is visible at night
        const nightPhase = 1.0 - Math.max(0, Math.sin((timeOfDay - 0.25) * Math.PI * 2));
        celestialObjects.moonLight.intensity = nightPhase * 0.3;
    }
    
    // Update star visibility - fade out during day
    const starOpacity = 1.0 - Math.max(0, Math.sin((timeOfDay - 0.25) * Math.PI * 2));
    celestialObjects.stars.forEach(star => {
        star.material.opacity = starOpacity * 0.9;
    });
    
    // Update sky shader uniforms
    skyMaterial.uniforms.timeOfDay.value = timeOfDay;
    skyMaterial.uniforms.sunDirection.value.set(0, sunY, sunZ).normalize();
    
    // Update scene background color and fog based on time of day
    const nightColor = new THREE.Color(0x02001A);
    const dayColor = new THREE.Color(0x87CEEB);
    const sunsetColor = new THREE.Color(0xFF6B35);
    
    // Fog colors match atmospheric conditions
    const nightFogColor = new THREE.Color(0x0a0a20);
    const dayFogColor = new THREE.Color(0xb0d4f1);
    const sunsetFogColor = new THREE.Color(0xffa070);
    
    const dayFactor = Math.max(0, Math.sin((timeOfDay - 0.25) * Math.PI * 2));
    const sunsetFactor = (Math.sin((timeOfDay - 0.2) * Math.PI * 4) + 1) * 0.5 * (1 - dayFactor);
    
    const currentColor = nightColor.clone().lerp(dayColor, dayFactor).lerp(sunsetColor, sunsetFactor * 0.3);
    scene.background.copy(currentColor);
    
    // Update fog color to match atmospheric haze
    const currentFogColor = nightFogColor.clone().lerp(dayFogColor, dayFactor).lerp(sunsetFogColor, sunsetFactor * 0.5);
    scene.fog.color.copy(currentFogColor);
    
    // Update ambient light based on time of day
    // Night: dim blue ambient, Day: bright white ambient, Sunset: warm orange ambient
    const nightAmbientColor = new THREE.Color(0x202040);
    const dayAmbientColor = new THREE.Color(0xffffff);
    const sunsetAmbientColor = new THREE.Color(0xffaa77);
    
    const currentAmbientColor = nightAmbientColor.clone().lerp(dayAmbientColor, dayFactor).lerp(sunsetAmbientColor, sunsetFactor * 0.6);
    ambientLight.color.copy(currentAmbientColor);
    
    // Ambient intensity: low at night (0.3), high during day (1.2)
    ambientLight.intensity = 0.3 + (dayFactor * 0.9);
}

// --- Wind System Update ---
function updateWind(dt) {
    windChangeTimer += dt;
    
    // Gradually change wind direction and strength
    if (windChangeTimer > WIND_CHANGE_INTERVAL) {
        windChangeTimer = 0;
        // New wind direction (gradual shift, not complete reversal)
        windDirection += (Math.random() - 0.5) * Math.PI * 0.5; // ±45 degree shift
        windStrength = 0.5 + Math.random() * 1.5; // 0.5-2.0
        
        if (DEBUG_CONSOLE) {
            console.log(`💨 Wind changed: ${(windDirection * 180 / Math.PI).toFixed(0)}° @ ${windStrength.toFixed(1)} strength`);
        }
    }
}

// --- Animation Loop ---
function animate(time) {
    requestAnimationFrame(animate);
    const dt = 1 / 60; // Assuming 60fps for simple physics/timing

    // --- Day/Night Cycle Update ---
    if (nightModeOnly) {
        timeOfDay = 0; // Keep it at night
    } else {
        timeOfDay = (timeOfDay + DAY_CYCLE_SPEED * dt) % 1.0;
    }
    updateDayNightCycle();
    
    // --- Wind System Update ---
    updateWind(dt);

    // --- Camera WASD movement (move the entire yawObject so camera moves with view direction) ---
    const moveSpeed = movement.speed * DEBUG_CAMERA_SPEED_MULT * dt; // Apply debug speed multiplier
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

    // Stream terrain chunks as you move across chunk boundaries
    if (terrainChunks) terrainChunks.update(yawObject.position);

    // Prepare frustum once per frame for culling
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    // Find nearest plane for debug HUD
    let nearestPlane = null;
    let nearestDist = Infinity;
    if (DEBUG_HUD) {
        if (planes.length === 0) {
            if (debugHUD) {
                debugHUD.innerHTML = `
<b>⚠️  NO PLANES LOADED</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Waiting for planes to spawn...
Check console for errors.
                `.trim();
            }
        } else {
            planes.forEach(p => {
                const dist = camWorldPos.distanceTo(p.mesh.position);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestPlane = p;
                }
            });
        }
    }

    planes.forEach(plane => {
        // Frustum culling: skip rendering planes outside camera view (but still update physics)
        const planeBox = new THREE.Box3().setFromObject(plane.mesh);
        plane.mesh.visible = frustum.intersectsBox(planeBox);
        
        // Vertical movement and altitude management (using AGL for clarity)
        const altitude = yToAGL(plane.mesh.position.y); // Height above ground level
        const maxClimbRate = plane.maxClimbRate || 1.2;
        const maxDescentRate = plane.maxDescentRate || 0.8;
        const climbPerformance = plane.climbPerformance || 1;

        // Initialize waypoint if not set
        if (!plane.waypoint) {
            plane.waypoint = generateWaypoint(plane.mesh.position);
        }

        // Update waypoint periodically (wander to new locations)
        plane.waypointTimer = (plane.waypointTimer || 0) + dt;
        if (plane.waypointTimer > (plane.waypointInterval || 30)) {
            plane.waypointTimer = 0;
            plane.waypointInterval = 30 + Math.random() * 40; // 30-70 seconds
            plane.waypoint = generateWaypoint(plane.mesh.position);
            if (DEBUG_CONSOLE) {
                console.log(`🎯 New waypoint: (${plane.waypoint.x.toFixed(0)}, ${plane.waypoint.y.toFixed(0)}, ${plane.waypoint.z.toFixed(0)})`);
            }
        }

        // --- Waypoint Navigation: 3D target-seeking with CURVED path interpolation ---
        // Initialize waypoint system if needed
        if (!plane.smoothWaypoint) {
            plane.smoothWaypoint = plane.waypoint.clone();
            plane.targetWaypoint = plane.waypoint.clone(); // The "next" waypoint we're blending toward
            plane.waypointBlendFactor = 1.0; // 0 = old waypoint, 1 = fully at target waypoint
            plane.waypointControlPoint = null; // Control point for curved path
        }
        
        // Calculate vector to current smooth waypoint (what we're navigating to right now)
        const toWaypoint = new THREE.Vector3().subVectors(plane.smoothWaypoint, plane.mesh.position);
        const waypointDistance = toWaypoint.length();
        
        // If we're close to the smooth waypoint, generate a new target and start blending
        if (waypointDistance < 200 && plane.waypointBlendFactor >= 0.99) {
            const newWaypoint = generateWaypoint(plane.mesh.position);
            
            // Start a smooth blend from current smoothWaypoint to new target
            plane.waypoint.copy(plane.smoothWaypoint); // Old waypoint = where we are now
            plane.targetWaypoint = newWaypoint; // New target
            plane.waypointBlendFactor = 0.0; // Start blending from 0 to 1
            
            // Generate a control point for a curved path (not direct route)
            // Create a point offset perpendicular to the direct path
            const directPath = new THREE.Vector3().subVectors(newWaypoint, plane.smoothWaypoint);
            const pathDistance = directPath.length();
            
            // Create a perpendicular vector for the curve offset
            const perpendicular = new THREE.Vector3(-directPath.z, 0, directPath.x).normalize();
            
            // Randomly curve left or right with varying intensity
            const curveDirection = Math.random() < 0.5 ? 1 : -1;
            const curveIntensity = 0.3 + Math.random() * 0.4; // 30-70% offset from direct path
            
            // Control point is at midpoint plus perpendicular offset
            const midpoint = new THREE.Vector3().addVectors(plane.smoothWaypoint, directPath.multiplyScalar(0.5));
            plane.waypointControlPoint = midpoint.add(perpendicular.multiplyScalar(pathDistance * curveIntensity * curveDirection));
            
            // Keep control point altitude in safe zone
            const controlAltitude = yToAGL(plane.waypointControlPoint.y);
            if (controlAltitude < SAFE_ZONE_MIN) {
                plane.waypointControlPoint.y = aglToY(SAFE_ZONE_MIN + 50);
            } else if (controlAltitude > SAFE_ZONE_MAX) {
                plane.waypointControlPoint.y = aglToY(SAFE_ZONE_MAX - 50);
            }
            
            if (DEBUG_CONSOLE) console.log(`✅ New curved path: curve ${curveDirection > 0 ? 'right' : 'left'}, intensity ${(curveIntensity * 100).toFixed(0)}%`);
        }
        
        // Gradually blend using quadratic Bezier curve (old -> control -> target)
        if (plane.waypointBlendFactor < 1.0) {
            // Use ease-out cubic interpolation for ultra-smooth transitions
            plane.waypointBlendFactor += 0.003; // Very slow blend rate for maximum smoothness
            plane.waypointBlendFactor = Math.min(1.0, plane.waypointBlendFactor);
            
            // Ease-out cubic: starts fast, ends slow
            const t = plane.waypointBlendFactor;
            const eased = 1 - Math.pow(1 - t, 3);
            
            // Quadratic Bezier curve: B(t) = (1-t)²P0 + 2(1-t)t*P1 + t²P2
            // P0 = old waypoint, P1 = control point, P2 = target waypoint
            const oneMinusT = 1 - eased;
            const bezier = new THREE.Vector3();
            
            bezier.addScaledVector(plane.waypoint, oneMinusT * oneMinusT);
            bezier.addScaledVector(plane.waypointControlPoint, 2 * oneMinusT * eased);
            bezier.addScaledVector(plane.targetWaypoint, eased * eased);
            
            plane.smoothWaypoint.copy(bezier);
        }
        
        // Calculate distances to floor and ceiling reference points
        const floorDist = altitude - MIN_HEIGHT_AGL;
        const ceilingDist = MAX_HEIGHT_AGL - altitude;
        const safeZoneMid = SAFE_ZONE_MIN + (SAFE_ZONE_MAX - SAFE_ZONE_MIN) * 0.5;
        
        // Ensure smooth waypoint altitude stays in safe zone (adjust if needed)
        const smoothWaypointAltitude = yToAGL(plane.smoothWaypoint.y);
        if (smoothWaypointAltitude < SAFE_ZONE_MIN) {
            plane.smoothWaypoint.y = aglToY(SAFE_ZONE_MIN + 20);
        } else if (smoothWaypointAltitude > SAFE_ZONE_MAX) {
            plane.smoothWaypoint.y = aglToY(SAFE_ZONE_MAX - 20);
        }
        
        // Calculate desired vertical speed toward SMOOTH waypoint (not abrupt waypoint)
        const altitudeError = yToAGL(plane.smoothWaypoint.y) - altitude;
        let desiredClimb = altitudeError * 0.06 * climbPerformance; // Even gentler proportional control
        
        // Danger zone avoidance (wide 150m zones) - override waypoint if needed
        if (floorDist < FLOOR_AVOIDANCE_DIST) {
            const urgency = 1.0 - (floorDist / FLOOR_AVOIDANCE_DIST);
            const avoidancePush = maxClimbRate * urgency * 0.6;
            desiredClimb += avoidancePush;
            
            // If in deep danger, move waypoint to upper safe zone
            if (floorDist < FLOOR_AVOIDANCE_DIST * 0.5 && waypointAltitude < safeZoneMid) {
                plane.waypoint.y = aglToY(safeZoneMid + Math.random() * (SAFE_ZONE_MAX - safeZoneMid));
                if (DEBUG_CONSOLE) console.log(`⚠️ FLOOR DANGER (${altitude.toFixed(0)}m): Waypoint moved up`);
            }
        }
        else if (ceilingDist < CEILING_AVOIDANCE_DIST) {
            const urgency = 1.0 - (ceilingDist / CEILING_AVOIDANCE_DIST);
            const avoidancePush = maxDescentRate * urgency * 0.6;
            desiredClimb -= avoidancePush;
            
            // If in deep danger, move waypoint to lower safe zone
            if (ceilingDist < CEILING_AVOIDANCE_DIST * 0.5 && waypointAltitude > safeZoneMid) {
                plane.waypoint.y = aglToY(SAFE_ZONE_MIN + Math.random() * (safeZoneMid - SAFE_ZONE_MIN));
                if (DEBUG_CONSOLE) console.log(`⚠️ CEILING DANGER (${altitude.toFixed(0)}m): Waypoint moved down`);
            }
        }
        
        // Calculate horizontal heading toward SMOOTH waypoint for ultra-smooth turns
        const dx = plane.smoothWaypoint.x - plane.mesh.position.x;
        const dz = plane.smoothWaypoint.z - plane.mesh.position.z;
        plane.targetHeading = Math.atan2(dx, dz);
        
        // STEP 4: Clamp to plane performance limits
        desiredClimb = THREE.MathUtils.clamp(desiredClimb, -maxDescentRate, maxClimbRate);
        
        // STEP 5: Apply smoothly with lerp
        plane.vSpeed = THREE.MathUtils.lerp(plane.vSpeed || 0, desiredClimb, 0.2);
        
        // Store for debugging
        plane.altitudeError = altitudeError;
        plane.lastDesiredClimb = desiredClimb;
        plane.floorDist = floorDist;
        plane.ceilingDist = ceilingDist;
        plane.inDangerZone = (floorDist < FLOOR_AVOIDANCE_DIST || ceilingDist < CEILING_AVOIDANCE_DIST);

        plane.mesh.position.y += plane.vSpeed * dt;

        // No hard caps - let target-seeking and danger zones handle everything naturally
        // Update properties after vertical change
        updatePlaneProperties(plane);

        // --- Realistic Plane Physics ---
        // Heading is now determined by waypoint (calculated above)
        
        // Smooth heading change: interpolate towards target with weighted momentum
        let headingDiff = plane.targetHeading - plane.heading;
        // Wrap difference to [-π, π]
        while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
        while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
        
        // Weighted yaw adjustment with momentum (dramatic changes over long periods)
        if (!plane.yawVelocity) plane.yawVelocity = 0;
        
        // Much more gradual acceleration for dramatic turns
        const yawAcceleration = headingDiff * 0.02; // Reduced from 0.06 - slower response to heading changes
        plane.yawVelocity += yawAcceleration;
        plane.yawVelocity *= 0.97; // Increased damping from 0.94 - maintains momentum longer
        
        // Limit yaw change rate for ultra-smooth turning
        const maxYawChange = 0.006; // Reduced from 0.012 - slower maximum turn rate
        plane.yawVelocity = THREE.MathUtils.clamp(plane.yawVelocity, -maxYawChange, maxYawChange);
        
        plane.heading += plane.yawVelocity;

        // Banking/roll effect: bank proportionally into turns based on yaw velocity
        // More dramatic roll for dramatic yaw changes, responding over time
        const targetRoll = THREE.MathUtils.clamp(-plane.yawVelocity * 40, -Math.PI / 4, Math.PI / 4); // Increased multiplier from 25 to 40
        
        // Smooth roll transition - takes time to bank into and out of turns
        if (!plane.rollVelocity) plane.rollVelocity = 0;
        const rollError = targetRoll - plane.roll;
        const rollAcceleration = rollError * 0.015; // Gradual roll acceleration
        plane.rollVelocity += rollAcceleration;
        plane.rollVelocity *= 0.93; // Damping for smooth roll
        
        // Limit roll change rate
        const maxRollChange = 0.008;
        plane.rollVelocity = THREE.MathUtils.clamp(plane.rollVelocity, -maxRollChange, maxRollChange);
        
        plane.roll += plane.rollVelocity;
        plane.roll = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, plane.roll)); // clamp roll to ±51° (more dramatic)

        // Dynamic pitch: respond to vertical speed in a simple, realistic way
        // Pitch angle should reflect the climb/descent rate
        // Note: In Three.js, rotation.x is NEGATIVE for nose up, POSITIVE for nose down
        // Use gentler pitch angles - planes can climb/descend gradually over time
        const targetPitch = THREE.MathUtils.clamp(
            -(plane.vSpeed || 0) * 0.25, // Even more reduced multiplier for very gentle pitch
            -Math.PI / 12,  // Max climb: -15 degrees (nose up) - more realistic
            Math.PI / 12    // Max dive: +15 degrees (nose down) - more realistic
        );
        
        // Very smooth, weighted gradual pitch changes
        // Use momentum-based smoothing - pitch changes slowly with weight
        if (!plane.pitchVelocity) plane.pitchVelocity = 0;
        
        const pitchError = targetPitch - plane.pitch;
        const pitchAcceleration = pitchError * 0.008; // Even more gentle acceleration (was 0.015)
        plane.pitchVelocity += pitchAcceleration;
        plane.pitchVelocity *= 0.95; // Increased damping for more gradual changes (was 0.92)
        
        // Limit pitch change rate for ultra-smooth transitions
        const maxPitchChange = 0.005; // Reduced max change for smoother transitions (was 0.008)
        plane.pitchVelocity = THREE.MathUtils.clamp(plane.pitchVelocity, -maxPitchChange, maxPitchChange);
        
        plane.pitch += plane.pitchVelocity;
        plane.pitch = Math.max(-Math.PI / 9, Math.min(Math.PI / 9, plane.pitch)); // safety clamp to ±20°

        // Update plane orientation (heading, pitch, roll)
        plane.mesh.rotation.order = 'YXZ'; // Euler order: yaw, pitch, roll
        plane.mesh.rotation.y = plane.heading;   // yaw
        plane.mesh.rotation.x = plane.pitch;     // pitch
        plane.mesh.rotation.z = plane.roll;      // roll (banking)

        // Move plane forward in its local Z direction (based on speed)
        plane.mesh.translateZ(plane.speed);
        
        // --- Apply Wind Effects ---
        // 1. Global wind drift (constant push in wind direction)
        const windPushX = Math.cos(windDirection) * windStrength * dt * 0.3;
        const windPushZ = Math.sin(windDirection) * windStrength * dt * 0.3;
        plane.mesh.position.x += windPushX;
        plane.mesh.position.z += windPushZ;
        
        // 2. Turbulence (random small movements for realism)
        plane.turbulenceTimer += dt;
        if (plane.turbulenceTimer > TURBULENCE_FREQUENCY) {
            plane.turbulenceTimer = 0;
            
            // Generate random turbulence offset (increased strength)
            const turbStrength = windStrength * 0.4; // Increased from 0.15 to 0.4
            plane.turbulenceOffset.set(
                (Math.random() - 0.5) * turbStrength,
                (Math.random() - 0.5) * turbStrength * 0.6, // Increased vertical turbulence
                (Math.random() - 0.5) * turbStrength
            );
        }
        
        // Apply turbulence with smooth interpolation
        plane.mesh.position.x += plane.turbulenceOffset.x * dt * 3;
        plane.mesh.position.y += plane.turbulenceOffset.y * dt * 3;
        plane.mesh.position.z += plane.turbulenceOffset.z * dt * 3;
        
        // Enhanced roll wobble from turbulence (multiple frequencies for realism)
        const turbulenceRoll = Math.sin(time * 0.5 + plane.lightTimer) * windStrength * 0.04 +
                              Math.sin(time * 1.2 + plane.lightTimer * 0.7) * windStrength * 0.025;
        plane.roll += turbulenceRoll * dt;
        
        // Add pitch wobble from turbulence
        const turbulencePitch = Math.sin(time * 0.8 + plane.lightTimer * 1.3) * windStrength * 0.02 +
                               Math.sin(time * 1.5 + plane.lightTimer * 0.5) * windStrength * 0.015;
        plane.pitch += turbulencePitch * dt;
        
        // Add subtle yaw wobble (wind buffeting)
        const turbulenceYaw = Math.sin(time * 0.6 + plane.lightTimer * 0.9) * windStrength * 0.03;
        plane.heading += turbulenceYaw * dt;

        // 2. Despawn/respawn: if plane is outside the despawn bounding box around the camera, respawn it
        const despawnHalf = DESPAWN_BOX_SIZE / 2;
        if (Math.abs(plane.mesh.position.x - camWorldPos.x) > despawnHalf ||
            Math.abs(plane.mesh.position.z - camWorldPos.z) > despawnHalf) {
            respawnPlane(plane, camWorldPos);
            return; // continue to next plane
        }

        // 3. Navigation Lights Flashing
        plane.lightTimer += dt;
        // Calculate light multiplier based on time of day
        // Lights are brightest at night (1.0) and dimmest during day (0.2)
        const dayPhase = Math.max(0, Math.sin((timeOfDay - 0.25) * Math.PI * 2));
        const lightMultiplier = 1.0 - (dayPhase * 0.8); // Night: 1.0, Day: 0.2
        flashNavigationLights(plane, plane.lightTimer, lightMultiplier);
    });

    // Update debug HUD with nearest plane info
    if (DEBUG_HUD && debugHUD && nearestPlane) {
        const p = nearestPlane;
        const altitude = yToAGL(p.mesh.position.y);
        const floorDist = altitude - MIN_HEIGHT_AGL;
        const ceilingDist = MAX_HEIGHT_AGL - altitude;
        
        // Determine flight zone
        let zone = '✈️ SAFE ZONE';
        let zoneColor = '#0f0'; // green
        
        if (altitude < SAFE_ZONE_MIN) {
            zone = '⚠️ BELOW SAFE ZONE';
            zoneColor = '#ff0';
            if (floorDist < FLOOR_AVOIDANCE_DIST * 0.5) {
                zone = '🚨 FLOOR DANGER';
                zoneColor = '#f00';
            }
        } else if (altitude > SAFE_ZONE_MAX) {
            zone = '⚠️ ABOVE SAFE ZONE';
            zoneColor = '#ff0';
            if (ceilingDist < CEILING_AVOIDANCE_DIST * 0.5) {
                zone = '🚨 CEILING DANGER';
                zoneColor = '#f00';
            }
        }
        
        debugHUD.style.color = zoneColor;
        
        const waypointDist = p.waypoint ? p.mesh.position.distanceTo(p.waypoint) : 0;
        const waypointAlt = p.waypoint ? yToAGL(p.waypoint.y) : 0;
        const smoothWaypointDist = p.smoothWaypoint ? p.mesh.position.distanceTo(p.smoothWaypoint) : 0;
        const smoothWaypointAlt = p.smoothWaypoint ? yToAGL(p.smoothWaypoint.y) : 0;
        
        debugHUD.innerHTML = `
<b>🛩️  NEAREST PLANE (${nearestDist.toFixed(0)}m away)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Zone:</b> ${zone}

<b>Altitude:</b> ${altitude.toFixed(0)}m AGL
<b>Target WP:</b> ${waypointDist.toFixed(0)}m @ ${waypointAlt.toFixed(0)}m
<b>Smooth WP:</b> ${smoothWaypointDist.toFixed(0)}m @ ${smoothWaypointAlt.toFixed(0)}m (Δ ${(p.altitudeError || 0).toFixed(0)}m)
<b>Safe Zone:</b> ${SAFE_ZONE_MIN}-${SAFE_ZONE_MAX}m

<b>Floor:</b> ${floorDist.toFixed(0)}m ${floorDist < FLOOR_AVOIDANCE_DIST ? `⚠️ ${((1.0 - floorDist/FLOOR_AVOIDANCE_DIST)*100).toFixed(0)}%` : '✓'}
<b>Ceiling:</b> ${ceilingDist.toFixed(0)}m ${ceilingDist < CEILING_AVOIDANCE_DIST ? `⚠️ ${((1.0 - ceilingDist/CEILING_AVOIDANCE_DIST)*100).toFixed(0)}%` : '✓'}

<b>vSpeed:</b> ${(p.vSpeed || 0).toFixed(2)} m/s ${p.vSpeed > 0.5 ? '⬆️' : p.vSpeed < -0.5 ? '⬇️' : '→'}
<b>Pitch:</b> ${((p.pitch || 0) * 180 / Math.PI).toFixed(1)}° | <b>Roll:</b> ${((p.roll || 0) * 180 / Math.PI).toFixed(1)}°
<b>Speed:</b> ${(p.speed || 0).toFixed(1)} u/f | <b>Heading:</b> ${((p.heading || 0) * 180 / Math.PI).toFixed(0)}°
        `.trim();
    }

    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate(0); // Start the loop