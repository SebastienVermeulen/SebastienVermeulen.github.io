// ------------------------------------------
//  Vertex Deformations
// ------------------------------------------
vec3 Math_RotateY(vec3 position, float angle)
{
    float c = cos(angle);
    float s = sin(angle);

    return vec3(
        position.x * c - position.z * s,
        position.y,
        position.x * s + position.z * c);
}

vec3 Math_Helix(vec3 position, float twistAmount, float distance)
{
    float r = length(position.xz);
    float theta = atan(position.z, position.x);
    theta += twistAmount * position.y;
    r *= distance;

    return vec3(
        r * cos(theta),
        position.y,
        r * sin(theta));
}

vec3 Math_ArchimedeanSpiral_NoRotation(vec3 position, float anglePerHeight, float scalePerHeight)
{
    // The angle is based on the height the position finds itself at
    float theta = anglePerHeight * position.y;

    // From this height we also determine the offset scale or radius
    float radius = scalePerHeight * position.y;

    // Knowing both we can determine the offset of the position
    return vec3(
        radius * cos(theta) + position.x,
        position.y,
        radius * sin(theta) + position.z);
}

vec3 Math_ArchimedeanSpiral_Rotation(vec3 position, float anglePerHeight, float scalePerHeight)
{
    // The angle is based on the height the position finds itself at
    float theta = anglePerHeight * position.y;

    // From this height we also determine the offset scale or radius
    float radius = scalePerHeight * position.y;

    // Rotation around y based on the applied rotation in the spiral
    position = Math_RotateY(position, theta);

    // Knowing both rotation and radius we can determine the offset of the position
    return vec3(
        radius * cos(theta) + position.x,
        position.y,
        radius * sin(theta) + position.z);
}

vec3 Math_Bend(vec3 position, vec3 bendAxis, vec3 bendOrigin, float bendAngle)
{
    vec3 axisNorm = normalize(bendAxis);

    // Translate point so that bendOrigin is at the origin
    vec3 localPos = position - bendOrigin;

    // Project p onto the axisNorm
    float axisCoord = dot(localPos, axisNorm);
    vec3 axisPoint = axisNorm * axisCoord;

    // Get the vector perpendicular to the axisNorm
    vec3 perpendicular = localPos - axisPoint;
    float length = length(perpendicular);

    // If the perpendicular length is near zero, avoid division by zero
    if(length < 1e-5)
    {
        return position;
    }

    // Compute the bending angle for this point along the perpendicular plane
    float theta = bendAngle * position.y;

    // Build rotation around axisNorm
    float c = cos(theta);
    float s = sin(theta);

    // Rodrigues' rotation formula
    vec3 rotatedPerp = perpendicular * c
        + cross(axisNorm, perpendicular) * s
        + axisNorm * dot(axisNorm, perpendicular) * (1.0 - c);

    // Return transformed point
    return axisPoint + rotatedPerp + bendOrigin;
}

// ------------------------------------------
//  Fragment Methods
// ------------------------------------------

// ==========================================================
// Full Disney BRDF (Diffuse + Specular + Clearcoat + Sheen)
// Inputs:
//    N - normal
//    V - view direction
//    L - light direction
//    albedo - base color
//    roughness - main roughness
//    metallic - metalness
//    specularTint - 0..1
//    sheen - 0..1
//    sheenTint - 0..1
//    clearcoat - 0..1
//    clearcoatGloss - 0..1
// ==========================================================

const float PI = 3.14159265359;

// ------------------------
// Helper Functions
// ------------------------
float SchlickFresnel(float u) 
{
    float m = clamp(1.0 - u, 0.0, 1.0);
    float m2 = m * m;
    return m2 * m2 * m; // m^5
}

float G_GGX(float NdotV, float alphaG)
{
    return NdotV / (NdotV * (1.0 - alphaG) + alphaG);
}

float SmithG_GGX(float NdotV, float NdotL, float alphaG)
{
    return G_GGX(NdotV, alphaG) * G_GGX(NdotL, alphaG);
}

float D_GTR2(float NdotH, float alpha) 
{
    float alpha2 = alpha * alpha;
    float denom = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
    return alpha2 / (PI * denom * denom);
}

float D_GTR1(float NdotH, float a)
{
    float a2 = a * a;
    float t = 1.0 + (a2 - 1.0) * NdotH * NdotH;
    return (a2 - 1.0) / (PI * log(a2) * t);
}

float DiffuseWrap(float NoL, float wrap)
{
    return clamp((NoL + wrap) / (1.0 + wrap), 0.0, 1.0);
}

// ------------------------
// Diffuse (Burley)
// ------------------------
vec3 DisneyDiffuse(float NoL, float LoH, float NoV, vec3 albedo, float roughness)
{
    if (NoL <= 0.0)
    {
        return vec3(0.0);
    } 

    float FD90 = 0.5 + 2.0 * LoH * LoH * roughness;

    float Fd = (1.0 + (FD90 - 1.0) * pow(1.0 - NoL, 5.0)) *
               (1.0 + (FD90 - 1.0) * pow(1.0 - NoV, 5.0));

    return albedo * Fd * (1.0 / PI) * NoL;
}

// ------------------------
// Specular
// ------------------------
vec3 DisneySpecular(float NoH, float NoV, float NoL, float VoH, float roughness, vec3 F0)
{
    float alpha = roughness * roughness;

    float D = D_GTR2(NoH, alpha);
    float G = SmithG_GGX(NoV, NoL, alpha);
    float F = SchlickFresnel(VoH);
    vec3  Fr = mix(F0, vec3(1.0), F);

    return Fr * D * G / max(4.0 * NoV * NoL, 0.001);
}

// ------------------------
// Clearcoat
// ------------------------
float DisneyClearcoat(float NoH, float NoV, float NoL, float VoH, float clearcoat, float clearcoatGloss)
{
    float alpha = max(0.001, mix(0.1, 0.001, clearcoatGloss));
    float D = D_GTR1(NoH, alpha);
    float G = SmithG_GGX(NoV, NoL, 0.25); // fixed G
    float F = mix(0.04, 1.0, SchlickFresnel(VoH));

    return clearcoat * F * D * G / max(4.0 * NoV * NoL, 0.001);
}

// ------------------------
// Sheen
// ------------------------
vec3 DisneySheen(float VoH, vec3 albedo, float sheen, float sheenTint)
{
    float luminance = max(dot(albedo, vec3(0.3, 0.59, 0.11)), 0.001);
    vec3 tintColor = albedo / luminance;
    float Fsheen = SchlickFresnel(VoH);

    return sheen * Fsheen * mix(vec3(1.0), tintColor, sheenTint);
}

// ------------------------
// SSS
// ------------------------
vec3 SSSDiffuse(vec3 albedo, float NoL, float NoV, float width, vec3 sssColor)
{
    // wrapped lambert (softening)
    float wrapped = (NoL + width) / (1.0 + width);
    wrapped = clamp(wrapped, 0.0, 1.0);

    // SSS lobe should NOT use Burley
    return sssColor * albedo * wrapped * (1.0 / PI);
}

// ------------------------
// Full Disney BRDF
// ------------------------
vec3 DisneyBRDF(
    vec3 N, vec3 V, vec3 L,
    vec3 albedo, float roughness, float metallic,
    float specularTint, float sheen, float sheenTint,
    float clearcoat, float clearcoatGloss, float SSSStrength,
    float SSSWidth, vec3 SSSColor)
{
    // Base color for specular
    float lum = max(dot(albedo, vec3(0.3, 0.59, 0.11)), 0.001);
    vec3 tint = albedo / lum;
    // Dielectric specular base (tinted)
    vec3 F0_Spec = mix(vec3(0.04), tint, specularTint);
    // Metallic blends with baseColor
    vec3 F0 = mix(F0_Spec, albedo, metallic);

    // Needed dot products 
    vec3 H = normalize(V + L);
    float NoV = max(dot(N, V), 1e-5);
    float NoL = max(dot(N, L), 1e-5);
    float LoH = max(dot(L, H), 0.0);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 0.0);

    // Diffuse
    vec3 diffuseBurley   = (1.0 - metallic) * DisneyDiffuse(NoL, LoH, NoV, albedo, roughness);
    vec3 diffuseSSS = SSSDiffuse(albedo, NoL, NoV, SSSWidth, SSSColor);
    float back = max(dot(-N, L), 1e-5);
    vec3 backLight = SSSColor * albedo * pow(back, 1.5) * 0.3 * SSSStrength;

    vec3 diffuse = mix(diffuseBurley, diffuseSSS, SSSStrength) + backLight;

    // Specular & Additional
    vec3 specular = DisneySpecular(NoH, NoV, NoL, VoH, roughness, F0);
    vec3 clearc  = vec3(DisneyClearcoat(NoH, NoV, NoL, VoH, clearcoat, clearcoatGloss));
    vec3 sheeny  = DisneySheen(VoH, albedo, sheen, sheenTint);

    // Final combine
    return diffuse + specular + clearc + sheeny;
}



