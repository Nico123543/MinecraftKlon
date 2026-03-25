import type { BlockId } from '../shared/blocks';

interface HudStats {
  fps: number;
  onePercentLowFps: number;
  p95FrameMs: number;
  loadedChunks: number;
  pendingGenerate: number;
  pendingMesh: number;
}

interface HudControls {
  onSpeedMultiplierChange: (value: number) => void;
  onFlyToggle: (enabled: boolean) => void;
  onWaterToggle: (enabled: boolean) => void;
  onWaterFogToggle: (enabled: boolean) => void;
  onWaterAlphaToggle: (enabled: boolean) => void;
  onWaterShineToggle: (enabled: boolean) => void;
  onWaterPulseToggle: (enabled: boolean) => void;
  onWaterSortToggle: (enabled: boolean) => void;
  onWaterDepthToggle: (enabled: boolean) => void;
  onWaterSurfaceLayerToggle: (enabled: boolean) => void;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly statsEl: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly speedValueEl: HTMLSpanElement;
  private readonly waterStyleValueEl: HTMLSpanElement;

  constructor(container: HTMLElement, blockPalette: readonly BlockId[], controls: HudControls) {
    this.root = container;

    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';
    crosshair.textContent = '+';

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'perf-panel';

    const hotbar = document.createElement('div');
    hotbar.className = 'hotbar';

    for (let i = 0; i < blockPalette.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.textContent = i === 9 ? '0' : String(i + 1);
      hotbar.append(slot);
      this.slots.push(slot);
    }

    const controlsPanel = document.createElement('div');
    controlsPanel.className = 'controls-panel';

    const speedRow = document.createElement('label');
    speedRow.className = 'control-row';
    speedRow.innerHTML = 'Speed';

    const speedInput = document.createElement('input');
    speedInput.type = 'range';
    speedInput.min = '0.4';
    speedInput.max = '3.0';
    speedInput.step = '0.1';
    speedInput.value = '1.0';

    this.speedValueEl = document.createElement('span');
    this.speedValueEl.className = 'control-value';
    this.speedValueEl.textContent = '1.0x';

    speedInput.addEventListener('input', () => {
      const value = Number(speedInput.value);
      this.speedValueEl.textContent = `${value.toFixed(1)}x`;
      controls.onSpeedMultiplierChange(value);
    });
    speedRow.append(speedInput, this.speedValueEl);

    const flyRow = document.createElement('label');
    flyRow.className = 'control-row';
    flyRow.textContent = 'Fly';
    const flyInput = document.createElement('input');
    flyInput.type = 'checkbox';
    flyInput.className = 'fly-toggle';
    flyInput.addEventListener('change', () => {
      controls.onFlyToggle(flyInput.checked);
    });
    flyRow.append(flyInput);

    const waterToggleRow = document.createElement('label');
    waterToggleRow.className = 'control-row';
    waterToggleRow.textContent = 'Water On';
    const waterToggleInput = document.createElement('input');
    waterToggleInput.type = 'checkbox';
    waterToggleInput.checked = true;
    waterToggleInput.className = 'water-toggle';
    waterToggleInput.addEventListener('change', () => {
      controls.onWaterToggle(waterToggleInput.checked);
    });
    waterToggleRow.append(waterToggleInput);

    const waterFogRow = document.createElement('label');
    waterFogRow.className = 'control-row';
    waterFogRow.textContent = 'Fog';
    const waterFogInput = document.createElement('input');
    waterFogInput.type = 'checkbox';
    waterFogInput.checked = true;
    waterFogInput.className = 'water-toggle';
    waterFogInput.addEventListener('change', () => {
      controls.onWaterFogToggle(waterFogInput.checked);
    });
    waterFogRow.append(waterFogInput);

    const waterSurfaceLayerRow = document.createElement('label');
    waterSurfaceLayerRow.className = 'control-row';
    waterSurfaceLayerRow.textContent = 'Layer Top';
    const waterSurfaceLayerInput = document.createElement('input');
    waterSurfaceLayerInput.type = 'checkbox';
    waterSurfaceLayerInput.checked = true;
    waterSurfaceLayerInput.className = 'water-toggle';
    waterSurfaceLayerInput.addEventListener('change', () => {
      controls.onWaterSurfaceLayerToggle(waterSurfaceLayerInput.checked);
    });
    waterSurfaceLayerRow.append(waterSurfaceLayerInput);

    const waterAlphaRow = document.createElement('label');
    waterAlphaRow.className = 'control-row';
    waterAlphaRow.textContent = 'Alpha';
    const waterAlphaInput = document.createElement('input');
    waterAlphaInput.type = 'checkbox';
    waterAlphaInput.checked = true;
    waterAlphaInput.className = 'water-toggle';
    waterAlphaInput.addEventListener('change', () => {
      controls.onWaterAlphaToggle(waterAlphaInput.checked);
    });
    waterAlphaRow.append(waterAlphaInput);

    const waterShineRow = document.createElement('label');
    waterShineRow.className = 'control-row';
    waterShineRow.textContent = 'Shine';
    const waterShineInput = document.createElement('input');
    waterShineInput.type = 'checkbox';
    waterShineInput.checked = true;
    waterShineInput.className = 'water-toggle';
    waterShineInput.addEventListener('change', () => {
      controls.onWaterShineToggle(waterShineInput.checked);
    });
    waterShineRow.append(waterShineInput);

    const waterPulseRow = document.createElement('label');
    waterPulseRow.className = 'control-row';
    waterPulseRow.textContent = 'Pulse';
    const waterPulseInput = document.createElement('input');
    waterPulseInput.type = 'checkbox';
    waterPulseInput.checked = true;
    waterPulseInput.className = 'water-toggle';
    waterPulseInput.addEventListener('change', () => {
      controls.onWaterPulseToggle(waterPulseInput.checked);
    });
    waterPulseRow.append(waterPulseInput);

    const waterSortRow = document.createElement('label');
    waterSortRow.className = 'control-row';
    waterSortRow.textContent = 'Sort';
    const waterSortInput = document.createElement('input');
    waterSortInput.type = 'checkbox';
    waterSortInput.checked = false;
    waterSortInput.className = 'water-toggle';
    waterSortInput.addEventListener('change', () => {
      controls.onWaterSortToggle(waterSortInput.checked);
    });
    waterSortRow.append(waterSortInput);

    const waterDepthRow = document.createElement('label');
    waterDepthRow.className = 'control-row';
    waterDepthRow.textContent = 'Depth';
    const waterDepthInput = document.createElement('input');
    waterDepthInput.type = 'checkbox';
    waterDepthInput.checked = true;
    waterDepthInput.className = 'water-toggle';
    waterDepthInput.addEventListener('change', () => {
      controls.onWaterDepthToggle(waterDepthInput.checked);
    });
    waterDepthRow.append(waterDepthInput);

    const waterRow = document.createElement('div');
    waterRow.className = 'control-row';
    waterRow.textContent = 'Style';
    this.waterStyleValueEl = document.createElement('span');
    this.waterStyleValueEl.className = 'control-value';
    this.waterStyleValueEl.textContent = 'Classic';
    waterRow.append(this.waterStyleValueEl);

    controlsPanel.append(
      speedRow,
      flyRow,
      waterToggleRow,
      waterFogRow,
      waterSurfaceLayerRow,
      waterAlphaRow,
      waterShineRow,
      waterPulseRow,
      waterSortRow,
      waterDepthRow,
      waterRow
    );

    const hints = document.createElement('div');
    hints.className = 'hints';
    hints.textContent = 'Click: Pointer Lock | WASD: Move | Space: Jump/Up | Shift: Down (Fly) | LMB/RMB: Break/Place | 1-0: Block | V: Water Style';

    this.root.append(crosshair, this.statsEl, controlsPanel, hotbar, hints);
    this.setSelectedSlot(0);
  }

  setSelectedSlot(index: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].classList.toggle('active', i === index);
    }
  }

  updateStats(stats: HudStats): void {
    this.statsEl.innerHTML = [
      `FPS: ${stats.fps.toFixed(1)} | 1% low: ${stats.onePercentLowFps.toFixed(1)} | p95: ${stats.p95FrameMs.toFixed(2)} ms`,
      `Chunks: ${stats.loadedChunks} | Gen-Q: ${stats.pendingGenerate} | Mesh-Q: ${stats.pendingMesh}`
    ].join('<br/>');
  }

  setWaterStyle(name: string): void {
    this.waterStyleValueEl.textContent = name;
  }
}
