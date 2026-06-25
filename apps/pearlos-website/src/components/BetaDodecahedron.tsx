import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type FaceMedia =
  | { kind: "asset"; src: string }
  | { kind: "placeholder"; label: string; accent: string };

const videoPattern = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

const faceMedia: FaceMedia[] = [
  { kind: "asset", src: "/assets/beta-user-gif.gif" },
  { kind: "asset", src: "/assets/pearl-faces/face-02.png" },
  { kind: "asset", src: "/assets/pearl-faces/face-03.png" },
  { kind: "asset", src: "/assets/pearl-faces/face-04.png" },
  { kind: "asset", src: "/assets/pearl-animated.gif" },
  { kind: "asset", src: "/assets/team/Angel Funky Chameleon.png" },
  { kind: "placeholder", label: "Video slot 01", accent: "#3a7ba8" },
  { kind: "asset", src: "/assets/team/Kia Unicorn.png" },
  { kind: "asset", src: "/assets/team/VoidSprite.png" },
  { kind: "asset", src: "/assets/team/Paddy Croc.png" },
  { kind: "placeholder", label: "Video slot 02", accent: "#c89b3c" },
  { kind: "asset", src: "/assets/discover-pixel/C3 Superpowers 250x370.png" },
];

function makePlaceholderTexture(label: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 768;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#f7fbff");
    gradient.addColorStop(0.52, "#e9f0f4");
    gradient.addColorStop(1, "#d9e6ec");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 18;
    ctx.strokeRect(76, 76, canvas.width - 152, canvas.height - 152);

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(384, 326, 158, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#2d5168";
    ctx.font = "700 54px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 384, 402);
    ctx.font = "34px Arial, sans-serif";
    ctx.fillStyle = "#5b7686";
    ctx.fillText("placeholder", 384, 458);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export default function BetaDodecahedron() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const geometry = new THREE.DodecahedronGeometry(2.05, 0);
    const textureLoader = new THREE.TextureLoader();
    const videos: HTMLVideoElement[] = [];

    geometry.clearGroups();
    faceMedia.forEach((_, index) => geometry.addGroup(index * 9, 9, index));

    const materials = faceMedia.map((media) => {
      let texture: THREE.Texture;
      if (media.kind === "placeholder") {
        texture = makePlaceholderTexture(media.label, media.accent);
      } else if (videoPattern.test(media.src)) {
        const video = document.createElement("video");
        video.src = media.src;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";
        void video.play().catch(() => undefined);
        videos.push(video);
        texture = new THREE.VideoTexture(video);
      } else {
        texture = textureLoader.load(media.src);
      }

      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x0b2636,
        emissiveIntensity: 0.08,
        map: texture,
        metalness: 0.08,
        roughness: 0.38,
      });
    });

    const mesh = new THREE.Mesh(geometry, materials);
    scene.add(mesh);
    scene.add(new THREE.HemisphereLight(0xf8fcff, 0x1a4f72, 2.5));

    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(4, 5, 6);
    scene.add(key);
    camera.position.set(0, 0.25, 7.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 5.2;
    controls.maxDistance = 10;

    function resize() {
      const clientWidth = container?.clientWidth ?? 1;
      const clientHeight = container?.clientHeight ?? 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    }

    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      mesh.rotation.y += 0.0028;
      mesh.rotation.x += 0.0009;
      controls.update();
      renderer.render(scene, camera);
    }

    container.appendChild(renderer.domElement);
    window.addEventListener("resize", resize);
    resize();
    animate();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      controls.dispose();
      geometry.dispose();
      materials.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
      videos.forEach((video) => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="relative h-[54vh] min-h-[360px] w-full lg:h-[72vh]">
      <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
    </div>
  );
}
