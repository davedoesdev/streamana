// sample greyscale fragment shader
export default `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform bool u_rotate;

out vec4 colour;

vec4 grey(float x, float y) {
  vec3 color = texture(u_texture, vec2(x, y)).rgb;
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  return vec4(vec3(grey), 1.0);
}

void main() {
  ivec2 size = textureSize(u_texture, 0);
  float ar_texture = float(size.x) / float(size.y);
  if (u_rotate) {
    float ar_resolution = u_resolution.y / u_resolution.x;
    if (ar_resolution >= ar_texture) {
      float height = float(u_resolution.x) * ar_texture;
      float border_height = (u_resolution.y - height) / 2.0;
      if ((gl_FragCoord.y < border_height) ||
          (gl_FragCoord.y >= (border_height + height))) {
        colour = vec4(0);
      } else {
        colour = grey(1.0 - (gl_FragCoord.y - border_height) / height,
                      gl_FragCoord.x / u_resolution.x);
      }
    } else {
      float width = float(u_resolution.y) / ar_texture;
      float border_width = (u_resolution.x - width) / 2.0;
      if ((gl_FragCoord.x < border_width) ||
          (gl_FragCoord.x >= (border_width + width))) {
        colour = vec4(0);
      } else {
        colour = grey(1.0 - gl_FragCoord.y / u_resolution.y,
                      (gl_FragCoord.x - border_width) / width);
      }
    }
  } else {
    float ar_resolution = u_resolution.x / u_resolution.y;
    if (ar_resolution >= ar_texture) {
      float width = float(u_resolution.y) * ar_texture;
      float border_width = (u_resolution.x - width) / 2.0;
      if ((gl_FragCoord.x < border_width) ||
          (gl_FragCoord.x >= (border_width + width))) {
        colour = vec4(0);
      } else {
        colour = grey((gl_FragCoord.x - border_width) / width,
                      gl_FragCoord.y / u_resolution.y);
      }
    } else {
      float height = float(u_resolution.x) / ar_texture;
      float border_height = (u_resolution.y - height) / 2.0;
      if ((gl_FragCoord.y < border_height) ||
          (gl_FragCoord.y >= (border_height + height))) {
        colour = vec4(0);
      } else {
        colour = grey(gl_FragCoord.x / u_resolution.x,
                      (gl_FragCoord.y - border_height) / height);
      }
    }
  }
}`;
