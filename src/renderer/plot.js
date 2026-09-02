'use strict';

/**
 * Minimal dual-Y-axis strip chart on a 2D canvas — the JS counterpart of the
 * TwoYAxisPlot pyqtgraph widget. Temperatures share the left axis, TEC voltage
 * gets its own right axis, and the X axis is driven by the caller's rolling
 * time window.
 */
class DualAxisPlot {
  constructor(canvas, { xLabel = '', leftLabel = '', rightLabel = '' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.xLabel = xLabel;
    this.leftLabel = leftLabel;
    this.rightLabel = rightLabel;

    this.series = [];
    this.xMin = 0;
    this.xMax = 15;
    this.x = [];
    this.y = [];

    this.theme = {
      background: '#0f1216',
      grid: '#232a33',
      axis: '#4c5663',
      text: '#8b97a6',
      label: '#c7d0da',
      font: '11px system-ui, -apple-system, "Segoe UI", sans-serif'
    };

    this.pad = { top: 14, right: 62, bottom: 34, left: 62 };

    this.resize();
    this._onResize = () => {
      this.resize();
      this.draw();
    };
    window.addEventListener('resize', this._onResize);
  }

  /** @param {{name: string, color: string, axis: 'left'|'right'}[]} defs */
  setSeries(defs) {
    this.series = defs;
  }

  setXRange(min, max) {
    this.xMin = min;
    this.xMax = max > min ? max : min + 1;
  }

  /**
   * @param {number[]} x        shared time base
   * @param {number[][]} y      one array per series, same length as x
   */
  setData(x, y) {
    this.x = x;
    this.y = y;
  }

  clear() {
    this.x = [];
    this.y = this.series.map(() => []);
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
  }

  /** Round a raw step up to the nearest 1/2/5 x 10^n. */
  static niceStep(raw) {
    if (!(raw > 0)) return 1;
    const exponent = Math.floor(Math.log10(raw));
    const magnitude = Math.pow(10, exponent);
    const fraction = raw / magnitude;
    let nice = 10;
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    return nice * magnitude;
  }

  static ticks(min, max, target = 6) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
    const step = DualAxisPlot.niceStep((max - min) / target);
    const out = [];

    // Index off the step rather than accumulating, and round-trip through
    // toPrecision, so ticks stay inside [min, max] instead of drifting a few
    // float epsilons past the edge and being clipped when drawn.
    for (let i = Math.ceil(min / step - 1e-9); out.length <= 256; i += 1) {
      const v = Number((i * step).toPrecision(12));
      if (v > max + step * 1e-9) break;
      out.push(v === 0 ? 0 : v);
    }
    return out;
  }

  /** Autoscaled range over every series bound to `axis`, padded by 5%. */
  #rangeFor(axis) {
    let min = Infinity;
    let max = -Infinity;

    this.series.forEach((s, i) => {
      if (s.axis !== axis) return;
      const values = this.y[i];
      if (!values) return;
      for (let k = 0; k < values.length; k += 1) {
        const v = values[k];
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (max - min < 1e-9) {
      const centre = min;
      const span = Math.max(Math.abs(centre) * 0.05, 0.5);
      return [centre - span, centre + span];
    }
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }

  draw() {
    const ctx = this.ctx;
    const { top, right, bottom, left } = this.pad;
    const w = this.width;
    const h = this.height;
    const plotW = Math.max(1, w - left - right);
    const plotH = Math.max(1, h - top - bottom);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, w, h);
    ctx.font = this.theme.font;

    const hasRight = this.series.some((s) => s.axis === 'right');
    const [lMin, lMax] = this.#rangeFor('left');
    const [rMin, rMax] = this.#rangeFor('right');

    const xPos = (v) => left + ((v - this.xMin) / (this.xMax - this.xMin)) * plotW;
    const lPos = (v) => top + plotH - ((v - lMin) / (lMax - lMin)) * plotH;
    const rPos = (v) => top + plotH - ((v - rMin) / (rMax - rMin)) * plotH;

    // ---- grid + tick labels
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = this.theme.text;

    const yTicks = DualAxisPlot.ticks(lMin, lMax, 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach((v) => {
      const y = Math.round(lPos(v)) + 0.5;
      if (y < top - 1 || y > top + plotH + 1) return;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
      ctx.fillText(DualAxisPlot.#fmt(v), left - 6, y);
    });

    const xTicks = DualAxisPlot.ticks(this.xMin, this.xMax, 8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xTicks.forEach((v) => {
      const x = Math.round(xPos(v)) + 0.5;
      if (x < left - 1 || x > left + plotW + 1) return;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.stroke();
      ctx.fillText(DualAxisPlot.#fmt(v), x, top + plotH + 6);
    });

    if (hasRight) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      DualAxisPlot.ticks(rMin, rMax, 6).forEach((v) => {
        const y = rPos(v);
        if (y < top - 1 || y > top + plotH + 1) return;
        ctx.fillText(DualAxisPlot.#fmt(v), left + plotW + 6, y);
      });
    }

    // ---- frame
    ctx.strokeStyle = this.theme.axis;
    ctx.strokeRect(left + 0.5, top + 0.5, plotW, plotH);

    // ---- axis titles
    ctx.fillStyle = this.theme.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    if (this.xLabel) ctx.fillText(this.xLabel, left + plotW / 2, h - 2);

    if (this.leftLabel) {
      ctx.save();
      ctx.translate(11, top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText(this.leftLabel, 0, 0);
      ctx.restore();
    }
    if (this.rightLabel && hasRight) {
      ctx.save();
      ctx.translate(w - 4, top + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText(this.rightLabel, 0, 0);
      ctx.restore();
    }

    // ---- traces
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, plotW, plotH);
    ctx.clip();
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';

    this.series.forEach((s, i) => {
      const values = this.y[i];
      if (!values || values.length < 1) return;
      const toY = s.axis === 'right' ? rPos : lPos;

      ctx.strokeStyle = s.color;
      ctx.beginPath();
      let drawing = false;
      for (let k = 0; k < values.length; k += 1) {
        const vx = this.x[k];
        const vy = values[k];
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
          drawing = false;
          continue;
        }
        const px = xPos(vx);
        const py = toY(vy);
        if (drawing) ctx.lineTo(px, py);
        else {
          ctx.moveTo(px, py);
          drawing = true;
        }
      }
      ctx.stroke();
    });

    ctx.restore();
  }

  static #fmt(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}

window.DualAxisPlot = DualAxisPlot;
