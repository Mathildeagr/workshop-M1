import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LineChart } from './line-chart';

describe('LineChart', () => {
  let fixture: ComponentFixture<LineChart>;
  let el: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('label', 'Température');
    fixture.componentRef.setInput('unit', '°C');
    el = fixture.nativeElement;
  });

  it('affiche le libellé et la dernière valeur', () => {
    fixture.componentRef.setInput('values', [20, 21, 22.5]);
    fixture.detectChanges();
    expect(el.querySelector('h3')?.textContent).toContain('Température');
    expect(el.querySelector('.value')?.textContent).toContain('22.5 °C');
  });

  it('affiche un tiret sans données', () => {
    fixture.componentRef.setInput('values', []);
    fixture.detectChanges();
    expect(el.querySelector('.value')?.textContent).toContain('–');
    expect(fixture.componentInstance.points()).toBe('');
  });

  it('calcule les points sur toute la largeur et hauteur', () => {
    fixture.componentRef.setInput('values', [10, 20]);
    expect(fixture.componentInstance.points()).toBe('0,38 100,2');
  });

  it('gère une série constante sans division par zéro', () => {
    fixture.componentRef.setInput('values', [5, 5, 5]);
    expect(fixture.componentInstance.points()).toBe('0,38 50,38 100,38');
  });
});
