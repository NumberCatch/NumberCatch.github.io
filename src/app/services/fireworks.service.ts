import { Injectable } from '@angular/core';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
};

@Injectable({ providedIn: 'root' })
export class FireworksService {
  private canvas?: HTMLCanvasElement;
  private animationFrame?: number;
  private particles: Particle[] = [];

  constructor() {
    if (typeof window !== 'undefined') window.numberCatchFireworks = () => this.launch();
  }

  launch(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    this.ensureCanvas();
    const { innerWidth: width, innerHeight: height } = window;
    for (let burst = 0; burst < 7; burst += 1) {
      window.setTimeout(() => {
        this.addBurst(width, height);
        if (this.animationFrame === undefined) this.animate();
      }, burst * 190);
    }
  }

  private ensureCanvas(): void {
    if (this.canvas) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'fireworks-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * ratio;
    this.canvas.height = window.innerHeight * ratio;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
  }

  private addBurst(width: number, height: number): void {
    const centerX = width * (0.2 + Math.random() * 0.6);
    const centerY = height * (0.18 + Math.random() * 0.35);
    const colors = ['#ef8354', '#2f80ed', '#ffd166', '#48a868', '#ef476f', '#ffffff'];
    for (let index = 0; index < 72; index += 1) {
      const angle = (Math.PI * 2 * index) / 72;
      const speed = 2.2 + Math.random() * 4.2;
      this.particles.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  private animate(): void {
    const canvas = this.canvas;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.scale(ratio, ratio);
    context.globalCompositeOperation = 'lighter';
    this.particles = this.particles.filter((particle) => particle.life > 0);
    for (const particle of this.particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.045;
      particle.vx *= 0.99;
      particle.life -= 0.01;
      context.globalAlpha = Math.max(particle.life, 0);
      context.fillStyle = particle.color;
      context.strokeStyle = particle.color;
      context.lineWidth = particle.size * 0.7;
      context.globalAlpha = Math.max(particle.life * 0.45, 0);
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(particle.x - particle.vx * 2.5, particle.y - particle.vy * 2.5);
      context.stroke();
      context.globalAlpha = Math.max(particle.life, 0);
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    if (this.particles.length > 0) {
      this.animationFrame = window.requestAnimationFrame(() => this.animate());
    } else {
      this.animationFrame = undefined;
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

declare global {
  interface Window {
    numberCatchFireworks: () => void;
  }
}
