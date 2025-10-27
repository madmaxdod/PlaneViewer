// Use bare imports so Vite (or another bundler/dev server) resolves the package from
// node_modules. This avoids browser errors like "Failed to resolve module specifier 'three'".
import * as THREE from 'three';
// We'll implement a minimal pointer-lock handler ourselves so we can restrict
// rotation to yaw only (no pitch or roll).

// --- Global Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

// Set a very dark background
scene.background = new THREE.Color(0x02001A); // Almost black, deep night sky blue
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Create a green "grass" ground to replace the default gray grid
// We'll generate a small canvas texture with a green gradient and subtle blade strokes,
// then tile it over a large plane.
const planeSize = 2000;
// Ground height (where the grid lies)
const GROUND_HEIGHT = 0;
const grassCanvas = document.createElement('canvas');
grassCanvas.width = 512;
grassCanvas.height = 512;
const gctx = grassCanvas.getContext('2d');
// base gradient (smooth)
const grd = gctx.createLinearGradient(0, 0, 0, grassCanvas.height);
grd.addColorStop(0, '#256029'); // darker
grd.addColorStop(0.5, '#3b8a45');
grd.addColorStop(1, '#6fcf7a'); // lighter
gctx.fillStyle = grd;
gctx.fillRect(0, 0, grassCanvas.width, grassCanvas.height);
// subtle blades: fewer, lighter strokes for a softer look
gctx.strokeStyle = 'rgba(0,40,0,0.045)';
gctx.lineWidth = 1;
for (let i = 0; i < 900; i++) {
    const x = Math.random() * grassCanvas.width;
    const y = Math.random() * grassCanvas.height;
    const len = 6 + Math.random() * 18;
    gctx.beginPath();
    gctx.moveTo(x, y);
    // slight curve for blade
    gctx.quadraticCurveTo(x + (Math.random() - 0.5) * 6, y - len * 0.5, x + (Math.random() - 0.5) * 2, y - len);
    gctx.stroke();
}
// light overlay to smooth the gradient/blades
gctx.globalAlpha = 0.18;
gctx.fillStyle = grd;
gctx.fillRect(0, 0, grassCanvas.width, grassCanvas.height);
gctx.globalAlpha = 1.0;

const grassTexture = new THREE.CanvasTexture(grassCanvas);
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(planeSize / 64, planeSize / 64);

const groundMat = new THREE.MeshLambertMaterial({ map: grassTexture });
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

// UI hint: simple overlay that tells the user to click to lock pointer
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
instructions.innerText = 'Click to look around (Esc to release)';
document.body.appendChild(instructions);

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
const MAX_HEIGHT = 500;
const MIN_HEIGHT = 250;
const MAX_PLANES = 10;

// Function to generate a random plane placeholder
function createPlanePlaceholder() {
    // A simple BoxGeometry as a placeholder for the plane model
    const geometry = new THREE.BoxGeometry(1, 0.2, 3);
    // Use a material that responds to lights so nav lights can illuminate the body
    const material = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.1 });
    const planeMesh = new THREE.Mesh(geometry, material);

    // --- Navigation Lights ---
    // Red Light (e.g., left wing)
    const redLight = new THREE.PointLight(0xFF0000, 0, 200, 1.5); // Start off (intensity=0), larger range
    redLight.position.set(-0.5, 0, -1);
    planeMesh.add(redLight);
    // visual indicator for the red nav light (so it's visible even on unlit materials)
    const redMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xFF0000, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
    );
    redMesh.position.copy(redLight.position);
    planeMesh.add(redMesh);
    
    // Green Light (e.g., right wing)
    const greenLight = new THREE.PointLight(0x00FF00, 0, 200, 1.5); // Start off
    greenLight.position.set(0.5, 0, -1);
    planeMesh.add(greenLight);
    const greenMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x00FF00, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
    );
    greenMesh.position.copy(greenLight.position);
    planeMesh.add(greenMesh);

    // White Light (e.g., tail)
    const whiteLight = new THREE.PointLight(0xFFFFFF, 0, 300, 1.5); // Start off, brighter range
    whiteLight.position.set(0, 0, 1.5);
    planeMesh.add(whiteLight);
    const whiteMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
    );
    whiteMesh.position.copy(whiteLight.position);
    planeMesh.add(whiteMesh);

    // --- Custom Plane Data ---
    const plane = {
        mesh: planeMesh,
        speed: 0, 
        redLight: redLight,
        greenLight: greenLight,
        whiteLight: whiteLight,
        redMesh: redMesh,
        greenMesh: greenMesh,
        whiteMesh: whiteMesh,
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
        plane.redLight.intensity = 1.5;
        plane.greenLight.intensity = 0;
        if (plane.redMesh) plane.redMesh.material.opacity = 1;
        if (plane.greenMesh) plane.greenMesh.material.opacity = 0;
    } else if (Math.sin(time * speed) < -0.8) {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = 1.5;
        if (plane.redMesh) plane.redMesh.material.opacity = 0;
        if (plane.greenMesh) plane.greenMesh.material.opacity = 1;
    } else {
        plane.redLight.intensity = 0;
        plane.greenLight.intensity = 0;
        if (plane.redMesh) plane.redMesh.material.opacity = 0;
        if (plane.greenMesh) plane.greenMesh.material.opacity = 0;
    }

    // White Light (Slower, Strobing effect)
    if (Math.sin(time * speed * 0.5) > 0.95) {
        plane.whiteLight.intensity = 6; // Brighter flash
        if (plane.whiteMesh) plane.whiteMesh.material.opacity = 1;
    } else {
        plane.whiteLight.intensity = 0;
        if (plane.whiteMesh) plane.whiteMesh.material.opacity = 0;
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

    // Keep the camera's Y position fixed so the camera never goes below the grid
    if (camera.position.y !== 2.0) camera.position.y = 2.0;

    // Prevent pitch and roll: keep camera local rotations at zero and allow only yaw on yawObject
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    yawObject.rotation.z = 0; // prevent roll

    // Keep the sky dome centered on the camera's world position so it appears infinite
    if (skyMesh) {
        const camWorldPos = new THREE.Vector3();
        camera.getWorldPosition(camWorldPos);
        skyMesh.position.copy(camWorldPos);
    }

    planes.forEach(plane => {
        // 1. Movement
        // Move the plane in its forward direction (Z-axis local space)
        plane.mesh.translateZ(plane.speed);

        // 2. Wrap-around functionality (reposition if too far)
        if (plane.mesh.position.x > 2000|| plane.mesh.position.x < -2000 ||
            plane.mesh.position.z > 300|| plane.mesh.position.z < -300) {
            
            // Reposition the plane to the opposite side of the scene
            // We use the rotation to determine which side to respawn on
            const directionZ = Math.cos(plane.mesh.rotation.y);
            const directionX = Math.sin(plane.mesh.rotation.y);

            // Simple repositioning (can be improved for more realism)
            if (Math.abs(directionX) > Math.abs(directionZ)) {
                // wrap to opposite side using half the plane size
                plane.mesh.position.x = directionX > 0 ? -planeSize / 2 : planeSize / 2;
            } else {
                plane.mesh.position.z = directionZ > 0 ? -planeSize / 2 : planeSize / 2;
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