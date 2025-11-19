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
    // Vector2 version
    if (initialMax instanceof THREE.Vector2) 
    {
        return new THREE.Vector2(
            oscillatingBounce(initialMax.x, steepness, frequency, time),
            oscillatingBounce(initialMax.y, steepness, frequency, time));
    }

    // Scalar version
    if (typeof initialMax === "number")
    {
        const signed = Math.sign(initialMax);
        const amplitude = signed * currentAmplitude(Math.abs(initialMax), steepness, time);
        return amplitude * Math.cos(frequency * time);
    }

    throw new TypeError("oscillatingBounce: unsupported type");
}

function lerpVectors(v1, v2, alpha)
{
    v1.x = v1.x + (v2.x - v1.x) * alpha;
    v1.y = v1.y + (v2.y - v1.y) * alpha;
    return v1;
}

function clamp(n , min, max)
{
    return Math.min(Math.max(n, min), max);
}

function clampVector(v, min, max)
{
    // Vector4 version
    if (v instanceof THREE.Vector4)
    {
        return new THREE.Vector4(
                clamp(v.x, min, max),
                clamp(v.y, min, max),
                clamp(v.z, min, max),
                clamp(v.w, min, max));
    }

    // Vector3 version
    if (v instanceof THREE.Vector3)
    {
        return new THREE.Vector3(
                clamp(v.x, min, max),
                clamp(v.y, min, max),
                clamp(v.z, min, max));
    }

    // Vector2 version
    if (v instanceof THREE.Vector2)
    {
        return new THREE.Vector2(
                clamp(v.x, min, max),
                clamp(v.y, min, max));
    }

    throw new TypeError("oscillatingBounce: unsupported type");
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
const material = new THREE.MeshPhysicalMaterial(
    {
        color: new THREE.Color(0.25, 0.7, 0.3),
        roughness: 0.45,
        metalness: 0.0,
        clearcoat: 0.0,
        clearcoatRoughness: 0.0,
        sheen: 0.1
    });

loadShader('./threejs.glsl').then((glslCode) =>
    {
        material.onBeforeCompile = (shader) =>
        {
            material.userData.shader = shader;

            shader.uniforms.bendAngle = { value: new THREE.Vector2(0.0, 0.0) };

            // Reuse existing material uniforms
            shader.uniforms.baseColor = { value: new THREE.Color(material.color) };
            shader.uniforms.roughness = { value: material.roughness };
            shader.uniforms.metalness = { value: material.metalness };
            shader.uniforms.clearcoat = { value: material.clearcoat };
            shader.uniforms.clearcoatGloss = { value: material.clearcoatRoughness };
            shader.uniforms.sheen = { value: material.sheen };
            shader.uniforms.SSSStrength = { value: 0.30 };
            shader.uniforms.SSSWidth = { value: 0.6 };
            shader.uniforms.SSSColor = { value: new THREE.Color(0.55, 1.0, 0.6) };

            shader.vertexShader =
                `
                    uniform vec2 bendAngle;

                    varying vec3 vWorldPosition;\n
                ` +
                glslCode +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
                        vec3 transformed = position;

                        // Bend angle flip
                        vec2 bendAngleSign = sign(bendAngle);

                        // Bend X
                        transformed = Math_Bend(
                            transformed,
                            vec3(0, 0, 1),                                     // BendAxis
                            bendAngleSign.x * vec3(-0.5, 0, 0),                   // BendOrigin
                            bendAngle.x);
                            
                        // Bend Z
                        transformed = Math_Bend(
                            transformed,
                            vec3(1, 0, 0),                                     // BendAxis
                            bendAngleSign.y * vec3(0, 0, -0.5),                   // BendOrigin
                            -bendAngle.y);
                    `);

            shader.fragmentShader =
                    `
                        uniform vec3  baseColor;
                        #ifndef USE_CLEARCOAT
                            uniform float clearcoat;
                        #endif //USE_CLEARCOAT
                        uniform float clearcoatGloss;
                        uniform float sheen;
                        uniform float SSSStrength;
                        uniform float SSSWidth;
                        uniform vec3  SSSColor;
                            
                        varying vec3 vWorldPosition;\n
                    ` +     
                    glslCode +
                    shader.fragmentShader.replace(
                        `#include <dithering_fragment>`,
                        `   
                            vec3 color;
                            vec3 N = normalize(normal);
                            vec3 V = normalize(cameraPosition - vWorldPosition);
                             // ----------------------------------
                            // Directional Lighting
                            {
                             #if NUM_DIR_LIGHTS > 0
                                // A bit lazy but realistically there will only be one directional source
                                vec3 L = normalize(directionalLights[0].direction);
                                color = DisneyBRDF(
                                    N, V, L,
                                    baseColor,
                                    roughness,
                                    metalness,
                                    0.0,    // specularTint
                                    sheen, 0.5,    // sheenTint
                                    clearcoat, clearcoatGloss,
                                    SSSStrength, SSSWidth, SSSColor) * directionalLights[0].color;
                            #endif //NUM_DIR_LIGHTS > 0
                            }
                            // ----------------------------------
                            // Local Lights
                            {
                            #if NUM_POINT_LIGHTS > 0
                                PointLight p;
                                vec3 L;
                                float distance;
                                float attenuation;
                                vec3 radiance;
                                #pragma unroll
                                for (int i = 0; i < NUM_POINT_LIGHTS; ++i)
                                {
                                    p = pointLights[i];
                                    L = normalize(p.position - vWorldPosition);
                                    distance = length(p.position - vWorldPosition);
                                    attenuation = pow( clamp(1.0 - distance / p.distance, 0.0, 1.0), p.decay );
                                    radiance = p.color * attenuation;
                                    // Evaluate your Disney BRDF
                                    color += DisneyBRDF(
                                        N, V, L,
                                        baseColor,
                                        roughness,
                                        metalness,
                                        0.0,      // specularTint
                                        sheen,
                                        0.5,      // sheenTint
                                        clearcoat,
                                        clearcoatGloss,
                                        SSSStrength,
                                        SSSWidth,
                                        SSSColor) * radiance;
                                }
                            #endif // NUM_POINT_LIGHTS > 0
                            }
                            // ----------------------------------
                            // Ambient Lighting
                            vec3 ambient = ambientLightColor * baseColor;
                           
                            color += ambient * 0.0;
                           
                            // ----------------------------------
                            // Hemispheric Lighting
                            HemisphereLight hemi = hemisphereLights[0];
                           
                            float t = dot(N, vec3(0,1,0)) * 0.5 + 0.5;
                           
                            // Irradiance (already includes intensity!)
                            vec3 hemiLight = mix(hemi.groundColor, hemi.skyColor, t);
                           
                            // Lambert diffuse
                            vec3 indirectDiffuse = hemiLight * baseColor * (1.0 / PI);
                           
                            float hemiStrength = 0.0; // Arbetrary
                            color += indirectDiffuse * hemiStrength;

                            // ----------------------------------
                            // Final color
                            gl_FragColor = vec4(color, 1.0);
  
                            #include <dithering_fragment>
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
        
            shader.uniforms.bendAngle = { value: new THREE.Vector2(0.0, 0.0) };
        
            shader.vertexShader = 
                `
                    uniform vec2 bendAngle;\n
                ` +
                glslCode +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
                        vec3 transformed = position;

                        // Bend angle flip
                        vec2 bendAngleSign = sign(bendAngle);

                        // Bend X
                        transformed = Math_Bend(
                            transformed,
                            vec3(0, 0, 1),                                     // BendAxis
                            bendAngleSign.x * vec3(-0.5, 0, 0),                   // BendOrigin
                            bendAngle.x);
                            
                        // Bend Z
                        transformed = Math_Bend(
                            transformed,
                            vec3(1, 0, 0),                                     // BendAxis
                            bendAngleSign.y * vec3(0, 0, -0.5),                   // BendOrigin
                            -bendAngle.y);
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
const dirIntensity = 2.0;
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

const ambientIntensity = 0.10;
const ambientLight = new THREE.AmbientLight(color, ambientIntensity);
scene.add(ambientLight);

const hemisphereIntensity = 0.25;
const skyColor = 0xB1E1FF;  // light blue
const groundColor = 0xB97A20;  // brownish orange
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, hemisphereIntensity);
scene.add(hemisphereLight);

const pointLight = new THREE.PointLight(color, 15.0, 5.0);

const pointLights = [
    new THREE.PointLight(0xff0000, 15.0, 4.0),
    new THREE.PointLight(0x00ff00, 10.0, 6.0),
    new THREE.PointLight(0x0000ff, 20.0, 5.0)
];
pointLights.forEach(light => scene.add(light));

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

        initialMaxTarget = oscillatingBounce(initialMaxReal, steepness, frequency, pressTime - releaseTime);
        initialMaxReal = initialMaxTarget;
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

        if (!isDragging)
        {
            invertDragDueToNegativeBend();
        }
        else
        {
            translateMouseDragToBendLocation();
        }

        isDragging = false;
        canDrag = false;
    });
    
// ----------------------------------------
// Interaction logic
// ----------------------------------------

// Bending gets done in carthesian coordinates

// Bounce
let initialMaxTarget = new THREE.Vector2(0.0, 0.0);
let initialMaxReal = new THREE.Vector2(0.0, 0.0);

// Regular cconst parameters
const absoluteMaxBend = 0.9;
const steepness = 0.2;
const frequency = 5.0;

function translateMouseDragToBendLocation()
{
    deltaMouse.copy(previousMouseEnd.clone().sub(previousMouseStart));

    // Position
    var cartesianMovement = new THREE.Vector2(0.0, 0.0);
    cartesianMovement.x = 4.0 * deltaMouse.x / renderer.domElement.width;
    cartesianMovement.y = 4.0 * deltaMouse.y / renderer.domElement.height;

    // Power needs to be added or subtracted from the difference in position
    initialMaxTarget = cartesianMovement.multiplyScalar(absoluteMaxBend);
    initialMaxTarget.copy(clampVector(initialMaxTarget, -absoluteMaxBend, absoluteMaxBend));
}

function invertDragDueToNegativeBend()
{
    if (initialMaxTarget.x < 0.0)
    {
        initialMaxTarget.x = -initialMaxTarget.x;
        initialMaxReal.x = -initialMaxReal.x;
    }
    if (initialMaxTarget.y < 0.0)
    {
        initialMaxTarget.y = -initialMaxTarget.y;
        initialMaxReal.y = -initialMaxReal.y;
    }
}

let lerpSpeed = 1.0;
function lerpToTarget(deltaTime)
{
    var lerp = lerpSpeed * deltaTime;

    // Power
    initialMaxReal.copy(lerpVectors(initialMaxReal, initialMaxTarget, lerp));
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

        var bendAngle = new THREE.Vector2(0.0, 0.0);
        lerpToTarget(deltaTime);

        if(!canDrag)
        {
            bendAngle = oscillatingBounce(initialMaxReal, steepness, frequency, elapsedTimeSinceMouseUp);
        }
        else
        {
            bendAngle = initialMaxReal;
        }

        // Update shader variables
        material.userData.shader.uniforms.bendAngle.value = [bendAngle.x, bendAngle.y];
        shadowMaterial.userData.shader.uniforms.bendAngle.value = [bendAngle.x, bendAngle.y];

        // Update light parameters
        const orbitDist = 3.0;
        pointLights.forEach((light, index)  =>
           {
                light.position.x = orbitDist * Math.sin(elapsedTime * (index + 1));
                light.position.y = orbitDist * Math.cos(elapsedTime * (index + 1));
           });
    }

    renderer.render( scene, camera );

    stats.end();
}

// Launch the main renderloop
animate();