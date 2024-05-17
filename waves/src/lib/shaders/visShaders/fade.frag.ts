// shader which fades the color of the texture
// by a factor of fadeFactor
export const fadeFrag = /* glsl */ `#version 300 es

precision highp float;
precision highp sampler2D;

in vec2 fragTexCoord;

uniform sampler2D tex;
uniform float fadeFactor;

out vec4 color;

void main() {
    color = vec4(texture(tex, fragTexCoord).xyz * fadeFactor, 1.0);
    // if (color.x < 0.01 && color.y < 0.01 && color.z < 0.01) {
    //     color = vec4(0.0, 0.0, 0.0, 0.0);
    // }
    // color = vec4(1.0, 1.0, 1.0, 1.0);
}
`;