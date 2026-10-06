import { Component, computed, input } from '@angular/core';

/** Courbe minimaliste en SVG, sans librairie externe. */
@Component({
  selector: 'app-line-chart',
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.css',
})
export class LineChart {
  label = input.required<string>();
  values = input.required<number[]>();
  unit = input('');
  color = input('#4f8cff');

  points = computed(() => {
    const v = this.values();
    if (v.length < 2) return '';
    const min = Math.min(...v);
    const range = Math.max(...v) - min || 1;
    return v.map((y, i) => `${(i / (v.length - 1)) * 100},${38 - ((y - min) / range) * 36}`).join(' ');
  });

  /** Même tracé, fermé sur l'axe du bas pour remplir l'aire. */
  area = computed(() => (this.points() ? `0,40 ${this.points()} 100,40` : ''));
}
