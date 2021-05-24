// samepl greyscale fragment shader
export default `
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;

void main() {
  vec2 st = gl_FragCoord.xy / u_resolution.xy;
  vec3 color = texture2D(u_texture, st).rgb;
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(vec3(grey), 1.0);
}`;
