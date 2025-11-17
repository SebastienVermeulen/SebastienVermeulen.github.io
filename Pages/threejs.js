import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js'; // For stat tracking, like FPS

// ----------------------------------------
// Helpers
// ----------------------------------------
const up = new THREE.Vector3(0, 1, 0);

function addDebugBoundingBox(object, scene) 
{
    // Remove existing debug box
    const existingBox = scene.getObjectByName(`debug_box_${object.uuid}`);
    if (existingBox) scene.remove(existingBox);
    
    // Create new bounding box helper
    const boxHelper = new THREE.BoxHelper(object, 0xff0000);
    boxHelper.name = `debug_box_${object.uuid}`;
    scene.add(boxHelper);
    
    // Force update
    boxHelper.update();
    
    return boxHelper;
}

function addDebugShadowBounds(light, scene)
{
    const cameraHelper = new THREE.CameraHelper(light.shadow.camera);
    scene.add(cameraHelper);
}

function resizeRendererToDisplaySize(renderer, maxPixelCount=3840*2160)
{
    const canvas = renderer.domElement;
    const pixelRatio = window.devicePixelRatio;
    var width  = Math.floor( canvas.clientWidth  * pixelRatio );
    var height = Math.floor( canvas.clientHeight * pixelRatio );
    const pixelCount = width * height;
    const renderScale = pixelCount > maxPixelCount ? Math.sqrt(maxPixelCount / pixelCount) : 1;
    width = Math.floor(width * renderScale);
    height = Math.floor(height * renderScale);

    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize)
    {
        renderer.setSize(width, height, false);
    }
    return needResize;
}

function resizeRendererAndUpdateAspect(renderer, camera)
{
    if (resizeRendererToDisplaySize(renderer)) 
    {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
    }
}

function triangleWave(t, freq = 1)
{
    return 1 - Math.abs(((t * freq) % 2) - 1);
}

function currentAmplitude(initialMax, steepness, time)
{
    return Math.max(0, initialMax - steepness * time);
}

// Add Abs to create one sided bounce
function oscillatingBounce(initialMax, steepness, frequency, time)
{
    var amplitude = currentAmplitude(initialMax, steepness, time);
    return amplitude * Math.cos(frequency * time);
}

// ----------------------------------------
//  Core rendering
// ----------------------------------------
// FPS
const targetFPS = 100; // The interals of the browser cause some slowdown, this actually roughly equals 60 fps
const frameInterval = 1000 / targetFPS;

let lastFrameTime = 0.0;
let delta = 0.0;

// Model loader
const modelLoader = new OBJLoader();

// Time
const clock = new THREE.Clock();

// Stats
const stats = new Stats();
document.body.appendChild(stats.dom);

// Setup renderer
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.shadowMap.enabled = true;

const div = document.getElementsByClassName("three-example-1")[0];
const windowSlot1 = div.childNodes[1];
windowSlot1.appendChild(renderer.domElement);

// Create scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, 1, 0.1, 1000 );

// ----------------------------------------
//  Materials setup
// ----------------------------------------
// Shader files
async function loadShader(url) 
{
    const res = await fetch(url);
    return await res.text();
}

// Materials
const material = new THREE.MeshStandardMaterial(
    {
        color: 0xFFFFFF,
        roughness: 0.5,
        metalness: 0.1
    });

loadShader('./threejs.glsl').then((glslCode) =>
    {
        material.onBeforeCompile = (shader) =>
        {
            material.userData.shader = shader;
        
            shader.uniforms.twistAmount = { value: 10 };
            shader.uniforms.helixRadius = { value: 1 };
            shader.uniforms.bendAxis = { value: new THREE.Vector3(0, 0, 1) };
            shader.uniforms.bendOrigin = { value: new THREE.Vector3(-1, 0, 0) };
            shader.uniforms.bendAngle = { value: 0 };
        
            shader.vertexShader =                 
                `
                    uniform float twistAmount;
                    uniform float helixRadius;
                    uniform vec3 bendAxis;
                    uniform vec3 bendOrigin;
                    uniform float bendAngle;\n
                ` + 
                glslCode +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
                        vec3 transformed = position;

                        transformed = Math_Bend(
                            transformed, 
                            bendAxis,
                            bendOrigin,
                            bendAngle);
                    `);
        };
    });

// Keep overal needs simple
const shadowMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
});

loadShader('./threejs.glsl').then((glslCode) =>
    {
        shadowMaterial.onBeforeCompile = (shader) =>
        {
            shadowMaterial.userData.shader = shader;
        
            shader.uniforms.twistAmount = { value: 10 };
            shader.uniforms.helixRadius = { value: 1 };
            shader.uniforms.bendAxis = { value: new THREE.Vector3(0, 0, 1) };
            shader.uniforms.bendOrigin = { value: new THREE.Vector3(-1, 0, 0) };
            shader.uniforms.bendAngle = { value: 0 };
        
            shader.vertexShader = 
                `
                    uniform float twistAmount;
                    uniform float helixRadius;
                    uniform vec3 bendAxis;
                    uniform vec3 bendOrigin;
                    uniform float bendAngle;\n
                ` +
                glslCode +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
                        vec3 transformed = position;

                        transformed = Math_Bend(
                            transformed,
                            bendAxis,
                            bendOrigin,
                            bendAngle);
                    `);
        };
    });

function checkMaterialCompilation()
{
    // TODO: Add these to an array
    return material.userData?.shader && shadowMaterial.userData?.shader;
}

// ----------------------------------------
//  Scene setup
// ----------------------------------------
// Add geometry
var model;
modelLoader.load( '../Files/Models/dragon-Reduced.obj', function ( loadedModel )
{
    model = loadedModel.children[0];
    model.material = material;
    model.customDepthMaterial = shadowMaterial; // Needed since we deform vertices in the vertex shader
    model.castShadow = true;
    model.receiveShadow = true;

    // Personal preference
    model.rotation.y = 3 * Math.PI / 4;

    scene.add( model );
}, 
undefined, function ( error )
{
    console.error( error );
});

// Camera
camera.position.y = 0.3;
camera.position.z = 1.5;

resizeRendererAndUpdateAspect(renderer, camera);

// Lighting
const color = 0xFFFFFF;
const dirIntensity = 1;
var dirLight = new THREE.DirectionalLight(color, dirIntensity);
dirLight.position.set(1, 1, 1);

// Shadow related settings
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 3;
dirLight.shadow.camera.left = -1;
dirLight.shadow.camera.right = 1;
dirLight.shadow.camera.top = 1;
dirLight.shadow.camera.bottom = -1;

scene.add(dirLight);

const ambientIntensity = 0.05;
const ambientLight = new THREE.AmbientLight(color, ambientIntensity);
scene.add(ambientLight);

const hemisphereIntensity = 0.25;
const skyColor = 0xB1E1FF;  // light blue
const groundColor = 0xB97A20;  // brownish orange
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, hemisphereIntensity);
scene.add(hemisphereLight);

// ----------------------------------------
// Input
// ----------------------------------------

// Main variables
let canDrag = false;
let isDragging = false;

let previousMouseStart = new THREE.Vector2(0, 0);
let previousMouseEnd = new THREE.Vector2(0, 0);
let releaseTime = 0.0;
let pressTime = 0.0;
let deltaMouse = new THREE.Vector2(0, 0);

// Grab
renderer.domElement.addEventListener('mousedown', e =>
    {
        canDrag = true;
        previousMouseStart.x = e.clientX;
        previousMouseStart.y = e.clientY;
        pressTime = clock.getElapsedTime();

        initialMax_Effective = oscillatingBounce(initialMax_Lerped, steepness, frequency, pressTime - releaseTime);
        initialMax_Lerped = initialMax_Effective;
    });

// Drag
renderer.domElement.addEventListener('mousemove', e => 
    {
        if (!canDrag)
        {
            return;
        }
        isDragging = true;

        previousMouseEnd.x = e.clientX;
        previousMouseEnd.y = e.clientY;

        translateMouseDragToBendLocation();
    });

// Release
window.addEventListener('mouseup', e =>
    {
        previousMouseEnd.x = e.clientX;
        previousMouseEnd.y = e.clientY;
        releaseTime = clock.getElapsedTime();

        if(!isDragging && initialMax_Effective < 0.0)
        {
            invertDragDueToNegativeBend();
        }
        else
        {
            translateMouseDragToBendLocation();
        }

        canDrag = false;
        isDragging = false;
    });
    
// ----------------------------------------
// Interaction logic
// ----------------------------------------

// There are 3 variable to track the user input:
//     1. - The effective target position
//     2. - The measured addition to the target position (movement while grabbing, that gets added on mouse release to 1.)
//     3. - The final position used for the deformation animation (lerps to 1.)

// When the user grabs the object then the oscillations should pause.
// And depending on his dragging we should make the bend more or less extreme, limited by absoluteMaxBend.
// Then when released the oscillations should resume from said position.

// TODO: It would be better to lerp the axis derectly

// Bounce
let bendOrigin_Effective = new THREE.Vector3(-1, 0, 0);
let bendAxis_Effective = new THREE.Vector3(0, 0, 1);
let initialMax_Effective = 0.0;

let bendOrigin_Addition = new THREE.Vector3(0, 0, 0);

let bendOrigin_Lerped = new THREE.Vector3(0, 0, 0);
let bendAxis_Lerped = new THREE.Vector3(0, 0, 0);
let initialMax_Lerped = 0.0;

// Regular cconst parameters
const absoluteMaxBend = 0.6;
const steepness = 0.2;
const frequency = 5.0;

function translateMouseDragToBendLocation()
{
    deltaMouse.copy(previousMouseEnd.clone().sub(previousMouseStart));

    // Position
    bendOrigin_Addition.x = 2.0 * deltaMouse.x / renderer.domElement.width;
    bendOrigin_Addition.z = 2.0 * deltaMouse.y / renderer.domElement.height;

    var additionLength = bendOrigin_Addition.length();
    var dotOfAddition = bendOrigin_Effective.dot(bendOrigin_Addition.normalize());
    if (1.0 < bendOrigin_Addition.normalize().length())
    {
        bendOrigin_Addition = bendOrigin_Addition.normalize();
    }
    bendOrigin_Effective = bendOrigin_Addition;

    // Axis is dependent on position
    bendAxis_Effective = bendOrigin_Addition.crossVectors(bendOrigin_Addition, up);

    // Power needs to be added or subtracted from the difference in position
    initialMax_Effective = absoluteMaxBend * dotOfAddition * additionLength;
}

function invertDragDueToNegativeBend()
{
    bendAxis_Effective = bendAxis_Effective.negate();
    bendAxis_Lerped = bendAxis_Effective;

    initialMax_Lerped = -initialMax_Lerped;
    initialMax_Effective = initialMax_Lerped;
}

let lerpSpeed = 1.0;
function lerpToTarget(deltaTime)
{
    var lerp = lerpSpeed * deltaTime;

    // Position
    bendOrigin_Lerped = bendOrigin_Lerped.lerpVectors(bendOrigin_Lerped, bendOrigin_Effective, lerp);

    // Axis
    bendAxis_Lerped = bendAxis_Lerped.lerpVectors(bendAxis_Lerped, bendAxis_Effective, lerp);

    // Power
    initialMax_Lerped = initialMax_Lerped + (initialMax_Effective - initialMax_Lerped) * lerp;
}

// ----------------------------------------
//  Animation, logic, & etc.
// ----------------------------------------
// Animation etc.
function animate(now)
{
    // ----------------------------------------
    // Frame Logic
    // ----------------------------------------
    requestAnimationFrame(animate);

    delta = now - lastFrameTime;
    if (delta < frameInterval)
    {
        return; // Skip this frame
    }
    lastFrameTime = now;

    // ----------------------------------------
    // Render logic
    // ----------------------------------------
    stats.begin();
    
    const elapsedTime = clock.getElapsedTime();                 // seconds since clock started
    const elapsedTimeSinceMouseUp = elapsedTime - releaseTime;  // seconds since clock started
    const elapsedTimeSinceMouseDown = elapsedTime - pressTime;  // seconds since clock started
    const deltaTime = delta / 1000.0;                           // seconds since last frame

    if (model && checkMaterialCompilation())
    {
        // Calculate the bounce and twist
        const twist = 0;
        const radius = 0.5;

        var bendAngle = 0.0;
        lerpToTarget(deltaTime);

        if(!canDrag)
        {
            bendAngle = oscillatingBounce(initialMax_Lerped, steepness, frequency, elapsedTimeSinceMouseUp);
        }
        else
        {
            bendAngle = initialMax_Lerped;
        }

        // Update shader variables
        material.userData.shader.uniforms.twistAmount.value = twist;
        material.userData.shader.uniforms.helixRadius.value = radius;
        material.userData.shader.uniforms.bendAxis.value = bendAxis_Lerped;
        material.userData.shader.uniforms.bendOrigin.value = bendOrigin_Lerped;
        material.userData.shader.uniforms.bendAngle.value = bendAngle;

        shadowMaterial.userData.shader.uniforms.twistAmount.value = twist;
        shadowMaterial.userData.shader.uniforms.helixRadius.value = radius;
        shadowMaterial.userData.shader.uniforms.bendAxis.value = bendAxis_Lerped;
        shadowMaterial.userData.shader.uniforms.bendOrigin.value = bendOrigin_Lerped;
        shadowMaterial.userData.shader.uniforms.bendAngle.value = bendAngle;

        //model.rotation.y += 0.01 * deltaTime;
    }

    renderer.render( scene, camera );

    stats.end();
}

// Launch the main renderloop
animate();