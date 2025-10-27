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
function animate(time) {
    requestAnimationFrame(animate);
    const dt = 1 / 60; // Assuming 60fps for simple physics/timing
  
    // IMPORTANT: Update the controls in the animation loop
    controls.update();

    planes.forEach(plane => {
        // 1. Movement
        // Move the plane in its forward direction (Z-axis local space)
        plane.mesh.translateZ(plane.speed);

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