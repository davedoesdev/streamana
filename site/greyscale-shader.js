// sample greyscale fragment shader
export default `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform bool u_rotate_portrait;

out vec4 colour;

vec4 grey(vec2 coord) {
  vec3 color = texture(u_texture, coord).rgb;
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  return vec4(vec3(grey), 1.0);
}

void main() {
  // note: assume we're always landscape
  vec2 coord;
  ivec2 size = textureSize(u_texture, 0);
  float aspect_ratio = float(size.x) / float(size.y);
  if (size.x > size.y) {
    float height = float(u_resolution.x) / aspect_ratio;
    float border_height = (u_resolution.y - height) / 2.0;
    if ((gl_FragCoord.y < border_height) ||
        (gl_FragCoord.y >= (border_height + height))) {
        colour = vec4(0);
    } else {
        colour = grey(vec2(gl_FragCoord.x / u_resolution.x,
                           (gl_FragCoord.y - border_height) / height));
    }
  } else if (u_rotate_portrait) {
    float height = float(u_resolution.y) * aspect_ratio;
    float border_height = (u_resolution.y - height) / 2.0;
    if ((gl_FragCoord.y < border_height) ||
        (gl_FragCoord.y >= (border_height + height))) {
        colour = vec4(0);
    } else {
        colour = grey(vec2(gl_FragCoord.y / u_resolution.y,
                           (gl_FragCoord.x - border_height) / height));
    }
    // TODO: also doesn't this flip the image?
  } else {
    float width = float(u_resolution.y) * aspect_ratio;
    float border_width = (u_resolution.x - width) / 2.0;
    if ((gl_FragCoord.x < border_width) ||
        (gl_FragCoord.x >= (border_width + width))) {
        colour = vec4(0);
    } else {
        colour = grey(vec2((gl_FragCoord.x - border_width) / width,
                           gl_FragCoord.y / u_resolution.y));
    }
  }
}`;
