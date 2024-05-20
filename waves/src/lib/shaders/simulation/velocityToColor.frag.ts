/** A shader which takes a velocity field and outputs
 * pretty colors. blue is negative, red is positive.
 */
export const velocityToColorFrag = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;

uniform sampler2D velocityTexture;

out vec4 color;

// Color the velocity field based on the magnitude (absolute value) of the velocity.
void main() {
    vec4 v = texture(velocityTexture, texCoord);
    
    float blue = max(-v.x, -v.y);
    blue = max(blue, 0.0);
    color = vec4(abs(v.xy), blue, 1.0);
}
`;