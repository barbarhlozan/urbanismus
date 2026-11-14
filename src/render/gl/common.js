// Small helpers the WebGL layers share.

// A linked program from vertex and fragment shader source, with the
// locations of the uniforms named: { p, u: { name: location } }.
export function program(gl, vs, fs, uniforms = []) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return { p, u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(p, n)])) };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// A colour (#rrggbb or rgb()) as [r, g, b] 0 … 1.
export const rgb = (c) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(c).trim());
  if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const n = /rgba?\(([^)]+)\)/.exec(c)?.[1].split(',').map(Number);
  return n ? n.slice(0, 3).map((v) => v / 255) : [0, 0, 0];
};
