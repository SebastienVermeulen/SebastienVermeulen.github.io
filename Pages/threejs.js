import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js'; // For stat tracking, like FPS

const enableStats = false;

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
if (enableStats)
{
    const stats = new Stats();
    document.body.appendChild(stats.dom);
}

// Setup renderer
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.shadowMap.enabled = true;

const div = document.getElementsByClassName("three-example-1")[0];
const windowSlot1 = div.childNodes[1];
windowSlot1.appendChild(renderer.domElement);

const renderTarget = new THREE.WebGLRenderTarget(renderer.domElement.width, renderer.domElement.height);

// Create scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, 1, 0.1, 1000 );
const orthoCamera = new THREE.OrthographicCamera( -1.0, 1.0, 1.0, -1.0, -1.0, 1.0 );

// ----------------------------------------
// Fullscreen pass setup
// ----------------------------------------

// Fullscreen scene
const prePassScene = new THREE.Scene();

// Simple fullscreen material
const prePassMaterial = new THREE.ShaderMaterial();

// Fullscreen quad
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), prePassMaterial);
prePassScene.add(fsQuad);

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
const material = new THREE.MeshPhysicalMaterial();
material.depthTest = true;
material.depthWrite = true;
material.transparent = false;

// Keep overal needs simple
const shadowMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
});

let shadersCanCompile = false;

// --------------
// Parameters
// --------------
// Try and keep the arrays consistent
const BRDFParams =
{
    baseColor: new Float32Array([
        0.05, 0.7, 0.15,            // Jade
        0.926, 0.621, 0.504,        // Copper
        0.9, 0.45, 0.55,            // Pink fabric
        0.8, 0.2, 0.1,            // Red clearcoat
        1.0, 0.85, 0.4]),            // Matte gold
    roughness: new Float32Array([
        0.15,
        0.3,
        0.6,
        0.1,
        0.6]),
    metallic: new Float32Array([
        0,
        1.0,
        0.0,
        0.0,
        1.0]),
    specularTint: new Float32Array([
        0,
        0.5,
        0,
        0,
        0.5]),
    sheen: new Float32Array([
        0.5,
        0,
        1.0,
        0.0,
        0.0]),
    sheenTint: new Float32Array([
        0,
        0,
        0.8,
        0,
        0]),
    clearcoat: new Float32Array([
        0,
        0,
        0,
        1,
        0]),
    clearcoatGloss: new Float32Array([
        0,
        0,
        0,
        0.9,
        0]),
    SSSStrength: new Float32Array([
        3.0,
        0,
        0,
        0,
        0]),
    SSSWidth: new Float32Array([
        0.9,
        0,
        0,
        0,
        0]),
    SSSColor: new Float32Array([
        0.7, 0.8, 0.1,
        0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,
        0.0, 0.0, 0.0]),
};
let BRDFParamsNumber = 5;

// For reference look in shader, it just transitions through all the BRDFParams based on the time, and fmod
let materialTransitionCounter = 0.0;

// --------------
// Compilation
// --------------
loadShader('./threejs.glsl').then((glslCode) =>
    {
        prePassMaterial.onBeforeCompile = (shader) =>
        {
            prePassMaterial.userData.shader = shader;

            shader.uniforms.cameraMatrixWorld = { value: new THREE.Matrix4() };
            shader.uniforms.cameraProjectionInverse = { value: new THREE.Matrix4() };
            shader.uniforms.sunDirection = { value: new THREE.Vector3() };

            shader.vertexShader =
            `
                varying vec2 vUv;
        
                void main() 
                {
                    vUv = position.xy * 0.5 + 0.5; // convert [-1,1] -> [0,1]
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            shader.fragmentShader =
            glslCode + 
            `
                uniform mat4 cameraMatrixWorld;
                uniform mat4 cameraProjectionInverse;
                uniform vec3 sunDirection;

                varying vec2 vUv;
        
                void main()
                {
                    // Convert UV to NDC space [-1, 1]
                    vec4 ndc = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
        
                    // Convert to view space
                    vec4 viewPos = cameraProjectionInverse * ndc;
                    viewPos /= viewPos.w;
        
                    // Convert to world space
                    vec3 worldPos = (cameraMatrixWorld * viewPos).xyz;
        
                    // Compute view direction
                    vec3 viewDir = normalize(worldPos - cameraMatrixWorld[3].xyz);
        
                    vec3 skyColor = GetSkyColor(viewDir, sunDirection);
        
                    // Simple coloring: encode direction as RGB
                    gl_FragColor = vec4(skyColor, 1.0);
                }
            `
        };

        material.onBeforeCompile = (shader) =>
        {
            material.userData.shader = shader;

            shader.uniforms.bendAngle = { value: new THREE.Vector2(0.0, 0.0) };

            // BRDF Parameters
            shader.uniforms.g_baseColor = { value: BRDFParams.baseColor };
            shader.uniforms.g_roughness = { value: BRDFParams.roughness };
            shader.uniforms.g_metallic = { value: BRDFParams.metallic };
            shader.uniforms.g_specularTint = { value: BRDFParams.specularTint };
            shader.uniforms.g_sheen = { value: BRDFParams.sheen };
            shader.uniforms.g_clearcoat = { value: BRDFParams.clearcoat };
            shader.uniforms.g_clearcoatGloss = { value: BRDFParams.clearcoatGloss };
            shader.uniforms.g_SSSStrength = { value: BRDFParams.SSSStrength };
            shader.uniforms.g_SSSWidth = { value: BRDFParams.SSSWidth };
            shader.uniforms.g_SSSColor = { value: BRDFParams.SSSColor };

            shader.uniforms.materialTransitionCounter = { value: materialTransitionCounter };

            shader.vertexShader =
                `
                    uniform vec2 bendAngle;

                    varying vec3 vWorldPosition;
                    varying vec2 vScreenUV;\n
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
                    `).replace(
                        '#include <project_vertex>',
                        `
                            #include <project_vertex>
                            vScreenUV = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
                        `
                    );

            shader.fragmentShader =
                    `
                        #define FRAGMENT
                        #define BRDF_STRUCTS ${BRDFParamsNumber}

                        uniform float materialTransitionCounter;

                        varying vec3 vWorldPosition;
                        varying vec2 vScreenUV;\n
                    ` +
                    glslCode +
                    shader.fragmentShader.replace(
                        `#include <dithering_fragment>`,
                        `
                            vec3 color;
                            vec3 N = normalize(normal);
                            vec3 V = normalize(cameraPosition - vWorldPosition);

                            int lowID = int(floor(materialTransitionCounter)) % BRDF_STRUCTS;
                            int highID = int(ceil(materialTransitionCounter)) % BRDF_STRUCTS;

                            BRDFParams BRDFParam;
                            // Terniary not available for structs in webgl 1.0
                            if (fract(materialTransitionCounter) < vScreenUV.x * (1.0 - vScreenUV.y))
                            {
                                BRDFParam = getBRDFParams(lowID);
                            }
                            else
                            {
                                BRDFParam = getBRDFParams(highID);
                            }

                            // ----------------------------------
                            // Directional Lighting
                            {
                             #if NUM_DIR_LIGHTS > 0
                                // A bit lazy but realistically there will only be one directional source
                                vec3 L = normalize(directionalLights[0].direction);
                                color = DisneyBRDF(
                                    N, V, L,
                                    BRDFParam.baseColor,
                                    BRDFParam.roughness,
                                    BRDFParam.metallic,
                                    BRDFParam.specularTint,
                                    BRDFParam.sheen,
                                    BRDFParam.sheenTint,
                                    BRDFParam.clearcoat,
                                    BRDFParam.clearcoatGloss,
                                    BRDFParam.SSSStrength,
                                    BRDFParam.SSSWidth, 
                                    BRDFParam.SSSColor) * directionalLights[0].color;
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
                                // Should unroll
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
                                        BRDFParam.baseColor,
                                        BRDFParam.roughness,
                                        BRDFParam.metallic,
                                        BRDFParam.specularTint,
                                        BRDFParam.sheen,
                                        BRDFParam.sheenTint,
                                        BRDFParam.clearcoat,
                                        BRDFParam.clearcoatGloss,
                                        BRDFParam.SSSStrength,
                                        BRDFParam.SSSWidth, 
                                        BRDFParam.SSSColor) * radiance;
                                }
                            #endif // NUM_POINT_LIGHTS > 0
                            }

                            // ----------------------------------
                            // Ambient Lighting
                            {
                                vec3 ambient = ambientLightColor * BRDFParam.baseColor;
                            
                                color += ambient * 0.0;
                            }
                                
                            // ----------------------------------
                            // Hemispheric Lighting
                            {
                            #if NUM_HEMI_LIGHTS > 0
                                HemisphereLight hemi = hemisphereLights[0];
                                
                                float t = dot(N, vec3(0,1,0)) * 0.5 + 0.5;
                                
                                // Irradiance (already includes intensity!)
                                vec3 hemiLight = mix(hemi.groundColor, hemi.skyColor, t);
                                
                                // Lambert diffuse
                                vec3 indirectDiffuse = hemiLight * BRDFParam.baseColor * (1.0 / PI);
                                
                                color += indirectDiffuse;
                            #endif // NUM_HEMI_LIGHTS > 0
                            }

                            // ----------------------------------
                            // Final color
                            color = Linear2sRGB(color);
                            gl_FragColor = vec4(color, 1.0);

                            #include <dithering_fragment>
                        `);
        };

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

        prePassMaterial.needsUpdate = true;
        material.needsUpdate = true;
        shadowMaterial.needsUpdate = true;

        shadersCanCompile = true;
    });

function checkMaterialCompilation()
{
    return material.userData?.shader && shadowMaterial.userData?.shader && prePassMaterial.userData?.shader;
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
camera.position.y = 0.5;
camera.position.z = 1.5;

resizeRendererAndUpdateAspect(renderer, camera);

// Lighting
const color = 0xFFFFFF;
const dirIntensity = 1.0;
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

const hemisphereIntensity = 0.2;
const skyColor = 0xB1E1FF;  // light blue
const groundColor = 0xB97A20;  // brownish orange
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, hemisphereIntensity);
scene.add(hemisphereLight);

const pointLights = [
    new THREE.PointLight(0xff0000, 1.0, 7.0),
    new THREE.PointLight(0x00ff00, 1.0, 7.0),
    new THREE.PointLight(0x0000ff, 1.0, 7.0)
];
pointLights.forEach(light => 
    {
        light.castShadow = true;  // Enable shadows for each point light

        // Optional: improve shadow quality
        light.shadow.mapSize.width = 1024;  // default is 512
        light.shadow.mapSize.height = 1024;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 10;

        scene.add(light)
    });

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
renderer.domElement.addEventListener('pointerdown', e =>
    {
        canDrag = true;
        previousMouseStart.x = e.clientX;
        previousMouseStart.y = e.clientY;
        pressTime = clock.getElapsedTime();

        initialMaxTarget = oscillatingBounce(initialMaxReal, steepness, frequency, pressTime - releaseTime);
        initialMaxReal = initialMaxTarget;

        // Capture the pointer
        renderer.domElement.setPointerCapture(e.pointerId);
    });

// Drag
renderer.domElement.addEventListener('pointermove', e =>
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
renderer.domElement.addEventListener('pointerup', e =>
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

        // Release the pointer
        renderer.domElement.releasePointerCapture(e.pointerId);
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
    if (enableStats)
    { 
        stats.begin();
    }
    
    const elapsedTime = clock.getElapsedTime();                 // seconds since clock started
    const elapsedTimeSinceMouseUp = elapsedTime - releaseTime;  // seconds since clock started
    const elapsedTimeSinceMouseDown = elapsedTime - pressTime;  // seconds since clock started
    const deltaTime = delta / 1000.0;                           // seconds since last frame

    materialTransitionCounter = 0.3 * elapsedTime;

    if (model && fsQuad && checkMaterialCompilation())
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

        // Update "prePass" shader variables
        prePassMaterial.userData.shader.uniforms.cameraMatrixWorld.value.copy(camera.matrixWorld);
        prePassMaterial.userData.shader.uniforms.cameraProjectionInverse.value.copy(camera.projectionMatrixInverse);
        prePassMaterial.userData.shader.uniforms.sunDirection.value.copy(dirLight.position);

        // Update shader variables
        material.userData.shader.uniforms.bendAngle.value = [bendAngle.x, bendAngle.y];
        material.userData.shader.uniforms.materialTransitionCounter.value = materialTransitionCounter;
        shadowMaterial.userData.shader.uniforms.bendAngle.value = [bendAngle.x, bendAngle.y];

        // Update light parameters
        const orbitDist = 5.0;
        pointLights.forEach((light, index)  =>
           {
                light.position.x = orbitDist * Math.sin(elapsedTime * (index + 1));
                light.position.y = orbitDist * Math.cos(elapsedTime * (index + 1));
           });
    }

    if (shadersCanCompile)
    {
        // Render
        renderer.setRenderTarget(renderTarget);
        
        // Render the sky
        renderer.render(prePassScene, orthoCamera);
        
        // Back to default framebuffer
        renderer.setRenderTarget(null);
        // Use renderTarget.texture as a background
        scene.background = renderTarget.texture;
        
        // Render the model
        renderer.render(scene, camera);
    }

    if (enableStats)
    {
        stats.end();
    }
}

// Launch the main renderloop
animate();
