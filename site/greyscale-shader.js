// sample greyscale fragment shader
export default `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform bool u_portrait;

out vec4 colour;

void main() {
  vec2 coord;
  if (u_portrait) {
    coord = gl_FragCoord.yx / u_resolution.yx;
  } else {
    coord = gl_FragCoord.xy / u_resolution.xy;
  }
  vec3 color = texture(u_texture, coord).rgb;
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  colour = vec4(vec3(grey), 1.0);
}`;
