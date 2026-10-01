// Ray-marched, thin-film torus. No images, libraries or external shader services.
export function startIridescence(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  if (!gl) {
    canvas.dataset.renderer = "fallback";
    return null;
  }
  const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
  const fragment = `
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    uniform vec2 pointer;
    mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
    float shape(vec3 p){
      p.xy=rot(-.48+sin(time*.09)*.08)*p.xy;
      p.yz=rot(.64+pointer.y*.1)*p.yz;
      p.xz=rot(.28+pointer.x*.1)*p.xz;
      p.x/=1.12;
      float angle=atan(p.y,p.x);
      float radius=1.59+.13*sin(angle*3.+time*.12);
      vec2 q=vec2(length(p.xy)-radius,p.z+.15*sin(angle*2.-time*.14));
      q=rot(angle*1.5+time*.12)*q;
      return (length(q/vec2(.31,.18))-1.)*.18;
    }
    vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(shape(p+e.xyy)-shape(p-e.xyy),shape(p+e.yxy)-shape(p-e.yxy),shape(p+e.yyx)-shape(p-e.yyx)));}
    vec3 environment(vec3 r){
      float strip=pow(max(0.,sin(r.y*4.5+r.x*2.8)),18.);
      float key=pow(max(0.,dot(r,normalize(vec3(-.5,.9,1.)))),35.);
      float band=smoothstep(.32,.36,r.y)*(1.-smoothstep(.52,.57,r.y));
      return vec3(.12,.15,.19)+strip*vec3(.7,.82,.85)+key*2.+band*.8;
    }
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*resolution.xy)/resolution.y;
      uv.x-=.27;
      uv.y+=.015;
      vec3 ro=vec3(0.,0.,5.4),rd=normalize(vec3(uv*3.8,-4.8));
      float t=0.; bool hit=false; vec3 p;
      for(int i=0;i<72;i++){p=ro+rd*t;float d=shape(p);if(d<.0014){hit=true;break;}t+=d*.86;if(t>9.)break;}
      vec3 color=vec3(0.);float alpha=0.;
      if(hit){
        vec3 n=normal(p),r=reflect(rd,n);
        float facing=max(0.,dot(n,-rd));
        float fresnel=pow(1.-facing,2.3);
        vec3 film=.53+.47*cos(6.28318*(vec3(.02,.27,.54)+facing*.8+sin(p.x*.7+p.y*.4)*.14+time*.015));
        film=mix(film,vec3(.7,.95,.89),.28);
        vec3 light=environment(r);
        color=film*light*(.32+fresnel*.9)+pow(light,vec3(2.))*.3;
        color+=pow(max(0.,dot(n,normalize(vec3(-.5,.8,1.)))),35.)*vec3(.7,.9,.95);
        color=pow(color,vec3(.86));
        alpha=.92;
      }
      gl_FragColor=vec4(color,alpha);
    }`;
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  const vs = compile(gl.VERTEX_SHADER, vertex),
    fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) {
    canvas.dataset.renderer = "fallback";
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.dataset.renderer = "fallback";
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const size = gl.getUniformLocation(program, "resolution"),
    clock = gl.getUniformLocation(program, "time"),
    mouse = gl.getUniformLocation(program, "pointer");
  let motion = true,
    visible = true,
    frame = 0,
    last = 0,
    elapsed = 0,
    previous = 0,
    pointer = [0, 0];
  canvas.dataset.renderer = "webgl";
  function draw(now = performance.now()) {
    frame = 0;
    if (visible && (now - last > 32 || !motion)) {
      if (motion && previous) elapsed += Math.min(now - previous, 100) / 1000;
      previous = now;
      last = now;
      gl.uniform2f(size, canvas.width, canvas.height);
      gl.uniform1f(clock, elapsed);
      gl.uniform2f(mouse, ...pointer);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (motion && visible) frame = requestAnimationFrame(draw);
  }
  function schedule() {
    if (!frame && visible) frame = requestAnimationFrame(draw);
  }
  const resize = new ResizeObserver(() => {
    const bounds = canvas.getBoundingClientRect(),
      ratio = Math.min(1, 1000 / bounds.width);
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    cancelAnimationFrame(frame);
    frame = 0;
    draw();
  });
  resize.observe(canvas);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    visible = false;
    canvas.dataset.renderer = "fallback";
  });
  return {
    setMotion(value) {
      motion = value;
      previous = 0;
      cancelAnimationFrame(frame);
      frame = 0;
      schedule();
    },
    setVisible(value) {
      visible = value;
      previous = 0;
      if (value) schedule();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    setPointer(x, y) {
      pointer = [x, y];
    },
  };
}
