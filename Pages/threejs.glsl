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
