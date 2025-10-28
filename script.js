import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

// --- Global Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

// Set a very dark background
scene.background = new THREE.Color(0x02001A); // Almost black, deep night sky blue
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Make the canvas focusable so it can receive keyboard events in some preview environments.
renderer.domElement.tabIndex = 0;
renderer.domElement.style.outline = 'none';
renderer.domElement.addEventListener('click', () => renderer.domElement.focus());

const grid = new THREE.GridHelper(500, 50, 0x333333, 0x111111);
scene.add(grid);

// Set camera position (viewer is on the ground, looking up)
camera.position.set(0, 50, 50);

// --- NEW: OrbitControls Setup ---
// 1. Initialize OrbitControls, linking the camera and the DOM element (renderer)
const controls = new OrbitControls(camera, renderer.domElement);

// 2. Adjust Control Parameters (optional, but helpful for a "flying overhead" view)
controls.enableDamping = true; // Provides a smoother, more realistic feel
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false; // Makes panning more intuitive
controls.maxPolarAngle = Math.PI * 0.9; // Prevents the user from flipping the camera completely upside down
controls.minDistance = 10; // Prevent zooming too close to the origin

// --- WASD Movement State ---
const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    speed: 60 // units per second (tweak for comfortable movement)
};

// Map keys to movement flags
function onKeyDown(event) {
    // Debug: show keydown events in the browser console
    console.log('keydown', event.code);
    switch (event.code) {
        case 'KeyW': movement.forward = true; break;
        case 'KeyS': movement.backward = true; break;
        case 'KeyA': movement.left = true; break;
        case 'KeyD': movement.right = true; break;
        case 'KeyQ': movement.down = true; break; // descend
        case 'KeyE': movement.up = true; break;   // ascend
        case 'KeyF': toggleFullscreen(); break;   // F = fullscreen toggle
    }
}

function onKeyUp(event) {
    // Debug: show keyup events in the browser console
    console.log('keyup', event.code);
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

// --- Fullscreen Toggle UI ---
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
    zIndex: 9999,
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

// Add a subtle ambient light for overall scene visibility
const ambientLight = new THREE.AmbientLight(0x404040, 5); // soft white light
scene.add(ambientLight);

// Array to hold our custom plane objects
const planes = [];

// --- Plane Configuration ---
const MAX_HEIGHT = 150;
const MIN_HEIGHT = 10;
const MAX_PLANES = 10;

// Function to generate a random plane placeholder
function createPlanePlaceholder() {
    // A simple BoxGeometry as a placeholder for the plane model
    const geometry = new THREE.BoxGeometry(1, 0.2, 3);
    const material = new THREE.MeshBasicMaterial({ color: 0x888888 }); // Grey body
    const planeMesh = new THREE.Mesh(geometry, material);

    // --- Navigation Lights ---
    // Red Light (e.g., left wing)
    const redLight = new THREE.PointLight(0xFF0000, 0, 10); // Start off (intensity=0)
    redLight.position.set(-0.5, 0, -1);
    planeMesh.add(redLight);
    
    // Green Light (e.g., right wing)
    const greenLight = new THREE.PointLight(0x00FF00, 0, 10); // Start off
    greenLight.position.set(0.5, 0, -1);
    planeMesh.add(greenLight);

    // White Light (e.g., tail)
    const whiteLight = new THREE.PointLight(0xFFFFFF, 0, 10); // Start off
    whiteLight.position.set(0, 0, 1.5);
    planeMesh.add(whiteLight);

    // --- Custom Plane Data ---
    const plane = {
        mesh: planeMesh,
        speed: 0, 
        redLight: redLight,
        greenLight: greenLight,
        whiteLight: whiteLight,
        lightTimer: Math.random() * 50 // Random start time for flashing
    };

    // Random initial position
    planeMesh.position.x = (Math.random() - 0.5) * 500;
    planeMesh.position.z = (Math.random() - 0.5) * 500;
    planeMesh.position.y = Math.random() * (MAX_HEIGHT - MIN_HEIGHT) + MIN_HEIGHT;
    
    // Random rotation (for movement direction)
    planeMesh.rotation.y = Math.random() * Math.PI * 2;
    
    // Set initial properties based on height
    updatePlaneProperties(plane);

    scene.add(planeMesh);
    planes.push(plane);
}

// Function to adjust size and speed based on Y-position (height)
function updatePlaneProperties(plane) {
    const heightRatio = (plane.mesh.position.y - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);

    // Higher planes are faster
    plane.speed = 0.05 + heightRatio * 0.4; 

    // Higher planes are scaled up (to appear larger due to being closer to the camera at higher viewing angles)
    // A more realistic approach would be to scale them *down* as they get farther away, but since the 
    // camera is near the ground, higher planes are often visually *closer* in the typical viewing frustum.
    // For this effect, we'll keep the size roughly constant or slightly increase it to emphasize high altitude.
    const sizeScale = 1 + heightRatio * 1.5;
    plane.mesh.scale.set(sizeScale, sizeScale, sizeScale);
}

// Function to handle the flashing navigation lights
function flashNavigationLights(plane, time) {
    const speed = plane.speed * 20; // Flashing is related to speed

    // Red/Green Flash (Alternating/Fast)
    if (Math.sin(time * speed) > 0.8) {
        plane.redLight.intensity = 1;
        plane.greenLight.intensity = 0;
    } else if (Math.sin(time * speed) < -0.8) {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = 1;
    } else {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = 0;
    }

    // White Light (Slower, Strobing effect)
    if (Math.sin(time * speed * 0.5) > 0.95) {
        plane.whiteLight.intensity = 5; // Brighter flash
    } else {
        plane.whiteLight.intensity = 0;
    }
}

// Initial plane generation
for (let i = 0; i < MAX_PLANES; i++) {
    createPlanePlaceholder();
}

// --- Animation Loop ---
let _prevTime = null;
function animate(time) {
    requestAnimationFrame(animate);

    // time is in milliseconds from requestAnimationFrame
    if (_prevTime === null) _prevTime = time;
    const dt = Math.max(0.0001, (time - _prevTime) / 1000); // seconds since last frame
    _prevTime = time;

    // --- Camera WASD movement (move both camera and controls.target) ---
    const moveSpeed = movement.speed * dt; // units per frame based on speed (units/sec)
    const moveOffset = new THREE.Vector3();
    if (movement.forward || movement.backward || movement.left || movement.right || movement.up || movement.down) {
        // Forward vector (ignore vertical component for forward/back strafing)
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        // Right vector
        const right = new THREE.Vector3();
        right.crossVectors(forward, camera.up).normalize();

        if (movement.forward) moveOffset.add(forward);
        if (movement.backward) moveOffset.sub(forward);
        if (movement.left) moveOffset.sub(right);
        if (movement.right) moveOffset.add(right);
        if (movement.up) moveOffset.y += 1;
        if (movement.down) moveOffset.y -= 1;

        if (moveOffset.lengthSq() > 0) {
            moveOffset.normalize().multiplyScalar(moveSpeed);
            camera.position.add(moveOffset);
            controls.target.add(moveOffset);
        }
    }

    // Update controls (damping, etc.) after moving camera/target
    controls.update();

    planes.forEach(plane => {
        // 1. Movement
        // Move the plane in its forward direction (Z-axis local space). The original code
        // used a per-frame speed; convert to frame-corrected movement by scaling with dt*60
        const frameFactor = dt * 60;
        plane.mesh.translateZ(plane.speed * frameFactor);

        // 2. Wrap-around functionality (reposition if too far)
        if (plane.mesh.position.x > 300 || plane.mesh.position.x < -300 ||
            plane.mesh.position.z > 300 || plane.mesh.position.z < -300) {
            
            // Reposition the plane to the opposite side of the scene
            // We use the rotation to determine which side to respawn on
            const directionZ = Math.cos(plane.mesh.rotation.y);
            const directionX = Math.sin(plane.mesh.rotation.y);

            // Simple repositioning (can be improved for more realism)
            if (Math.abs(directionX) > Math.abs(directionZ)) {
                plane.mesh.position.x = directionX > 0 ? -300 : 300;
            } else {
                plane.mesh.position.z = directionZ > 0 ? -300 : 300;
            }

            // Also slightly randomize height and rotation for variety
            plane.mesh.position.y = Math.random() * (MAX_HEIGHT - MIN_HEIGHT) + MIN_HEIGHT;
            plane.mesh.rotation.y = Math.random() * Math.PI * 2;
            updatePlaneProperties(plane); // Re-calculate speed/size
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