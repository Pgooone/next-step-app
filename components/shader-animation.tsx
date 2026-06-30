"use client";

import { useEffect, useRef } from "react";

/**
 * ShaderAnimation —— 首页（项目墙）深色试点的 WebGL 流光背景（第8.5轮 T5 · D-V1.2-67）。
 *
 * 由设计稿 `shader-homepage-fonts.html` 的原生 WebGL（vs/fs + 全屏 quad）逐行移植，
 * 零 three.js（用户拍板 D-V1.2-67：原生 WebGL 1:1 复刻成 React 组件）。
 *
 * 做「背景」而非全屏替换：absolute inset:0 z-index:0，垫在首页内容之后。
 *
 * 全部 WebGL/window/canvas/RAF 都在 useEffect 内（SSR 期不跑），canvas 用 ref 拿。
 * 本容器 build 跑不到分包（Google Fonts 不通）→ 无 build 安全网，SSR/bundle 雷只能靠
 * dev + 真浏览器暴露（同 ADR D-R7B-07），故务必 useEffect 隔离。
 *
 * 护栏（必做）：
 *   ① 标签隐藏 / 组件卸载 → cancelAnimationFrame（别后台空耗 GPU），可见再起。
 *   ② prefers-reduced-motion → 不起 RAF 循环、只画单帧。
 *   ③ WebGL 取不到 → 不画、靠 CSS 兜底（容器 fallback 深色径向渐变背景）。
 *   ④ resize → 重设 canvas 尺寸 + viewport。
 */
export function ShaderAnimation() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // WebGL 不可用时给容器加回退渐变（canvas 透明、露出底色不够深）。
  const fallbackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    // 护栏③：WebGL 不可用 → 纯深色径向渐变兜底，直接返回。
    if (!gl) {
      if (fallbackRef.current) {
        fallbackRef.current.style.background =
          "radial-gradient(120% 90% at 50% 35%, #11131a 0%, #05060a 70%, #000 100%)";
      }
      return;
    }

    // —— 着色器（移植自设计稿，逐行 1:1）——
    const vs = "attribute vec2 position; void main(){ gl_Position=vec4(position,0.0,1.0); }";
    const fs = [
      "#define TWO_PI 6.2831853072",
      "#define PI 3.14159265359",
      "precision highp float;",
      "uniform vec2 resolution;",
      "uniform float time;",
      "void main(void){",
      "  vec2 uv=(gl_FragCoord.xy*2.0-resolution.xy)/min(resolution.x,resolution.y);",
      "  float t=time*0.05;",
      "  float lineWidth=0.002;",
      "  vec3 color=vec3(0.0);",
      "  for(int j=0;j<3;j++){",
      "    for(int i=0;i<5;i++){",
      "      color[j]+=lineWidth*float(i*i)/abs(fract(t-0.01*float(j)+float(i)*0.01)*5.0 - length(uv) + mod(uv.x+uv.y,0.2));",
      "    }",
      "  }",
      "  gl_FragColor=vec4(color[0],color[1],color[2],1.0);",
      "}",
    ].join("\n");

    function compile(type: number, source: string): WebGLShader {
      const shader = gl!.createShader(type)!;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      return shader;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "resolution");
    const uTime = gl.getUniformLocation(program, "time");
    let time = 1.0;

    // 护栏④：resize → dpr 封顶 2，重设 canvas 尺寸 + viewport。
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(window.innerWidth * dpr);
      canvas!.height = Math.floor(window.innerHeight * dpr);
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
    }
    window.addEventListener("resize", resize);
    resize();

    function drawFrame() {
      gl!.uniform2f(uResolution, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, time);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }

    let rafId = 0;
    let running = false;

    function loop() {
      time += 0.018; // 用户拍板速度
      drawFrame();
      rafId = window.requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      rafId = window.requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    // 护栏②：尊重 reduced-motion → 只画单帧、不起循环。
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      time += 0.018;
      drawFrame(); // 静态单帧兜底
    } else {
      // 护栏①：标签隐藏暂停 RAF（别后台空耗 GPU），可见再起。
      function onVisibility() {
        if (document.hidden) stop();
        else start();
      }
      document.addEventListener("visibilitychange", onVisibility);
      if (!document.hidden) start();

      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("resize", resize);
        stop(); // 护栏①：组件卸载 → cancelAnimationFrame
      };
    }

    // reduced-motion 分支的 cleanup（无 RAF，只摘 resize）。
    return () => {
      window.removeEventListener("resize", resize);
      stop();
    };
  }, []);

  return (
    <div
      ref={fallbackRef}
      style={{ position: "absolute", inset: 0, zIndex: 0, background: "#000" }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
