// @vitest-environment jsdom
/**
 * MeasureTool: handles are keyboard reachable and nudge 1 px (10 px with Shift); every line's
 * estimate is an editable number that moves its end point; estimates are labelled as such.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requiredDimensions, type PhotoMeasurements } from '@/contracts/reconstruct';
import { distancePx } from '@/lib/reconstruct/measure';
import { MeasureTool } from './measure-tool';

afterEach(cleanup);

const PHOTO = { attachmentId: 'att_photo1', url: 'http://localhost/photo.jpg', filename: 'knob.jpg' };
const BASE: PhotoMeasurements = {
    attachmentId: 'att_photo1',
    imageWidth: 1200,
    imageHeight: 900,
    reference: { preset: 'credit_card', a: { x: 100, y: 700 }, b: { x: 956, y: 700 }, lengthMm: 85.6 },
    lines: [{ id: 'l1', kind: 'diameter', param: 'diameter_mm', a: { x: 300, y: 300 }, b: { x: 681, y: 300 } }],
};

function Harness({ initial, spy }: { initial: PhotoMeasurements; spy: (m: PhotoMeasurements) => void }) {
    const [value, setValue] = useState(initial);
    return (
        <MeasureTool
            photo={PHOTO}
            value={value}
            dims={requiredDimensions('knob')}
            onChange={(m) => {
                spy(m);
                setValue(m);
            }}
        />
    );
}

describe('MeasureTool', () => {
    it('shows the scale, the estimate from the photo and the perspective caveat', () => {
        render(<Harness initial={BASE} spy={vi.fn()} />);
        expect(screen.getByTestId('reference-scale').textContent).toContain('0.1000 mm/px');
        expect((screen.getByTestId('line-estimate') as HTMLInputElement).value).toBe('38.10');
        expect(screen.getAllByText('estimate from photo').length).toBeGreaterThan(0);
        expect(screen.getByTestId('perspective-caveat').textContent).toMatch(/caliper/);
        expect(screen.getByRole('group', { name: /Measurement canvas/ })).toBeTruthy();
    });

    it('nudges a focused handle with the arrow keys (1 px, Shift 10 px)', () => {
        const spy = vi.fn();
        render(<Harness initial={BASE} spy={spy} />);
        const end = screen.getByTestId('handle-l1-b');
        expect(end.getAttribute('tabindex')).toBe('0');
        expect(end.getAttribute('aria-label')).toMatch(/Outer diameter end, at 681, 300 px/);
        end.focus();
        fireEvent.keyDown(end, { key: 'ArrowRight' });
        expect(spy.mock.lastCall![0].lines[0].b).toEqual({ x: 682, y: 300 });
        fireEvent.keyDown(screen.getByTestId('handle-l1-b'), { key: 'ArrowDown', shiftKey: true });
        expect(spy.mock.lastCall![0].lines[0].b).toEqual({ x: 682, y: 310 });
        fireEvent.keyDown(screen.getByTestId('handle-ref-a'), { key: 'ArrowLeft' });
        expect(spy.mock.lastCall![0].reference.a).toEqual({ x: 99, y: 700 });
        // Other keys are ignored.
        const calls = spy.mock.calls.length;
        fireEvent.keyDown(screen.getByTestId('handle-ref-a'), { key: 'Enter' });
        expect(spy.mock.calls.length).toBe(calls);
    });

    it('typing an estimate moves the end point so the line measures that length', () => {
        const spy = vi.fn();
        render(<Harness initial={BASE} spy={spy} />);
        const input = screen.getByTestId('line-estimate') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '40' } });
        fireEvent.blur(input);
        const line = spy.mock.lastCall![0].lines[0];
        expect(line.a).toEqual({ x: 300, y: 300 });
        expect(distancePx(line.a, line.b) * 0.1).toBeCloseTo(40, 6);
        expect((screen.getByTestId('line-estimate') as HTMLInputElement).value).toBe('40.00');
    });

    it('switches the reference preset (quarter) and assigns a line to a dimension', () => {
        const spy = vi.fn();
        render(<Harness initial={BASE} spy={spy} />);
        fireEvent.change(screen.getByTestId('reference-preset'), { target: { value: 'us_quarter' } });
        expect(spy.mock.lastCall![0].reference).toMatchObject({ preset: 'us_quarter', lengthMm: 24.26 });
        fireEvent.change(screen.getByTestId('line-param'), { target: { value: 'height_mm' } });
        expect(spy.mock.lastCall![0].lines[0].param).toBe('height_mm');
    });

    it('adds a line only once there is a scale, with a default segment keyboard users can move', () => {
        const spy = vi.fn();
        render(<Harness initial={{ ...BASE, reference: null, lines: [] }} spy={spy} />);
        expect((screen.getByTestId('line-add') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId('reference-mark'));
        expect(spy.mock.lastCall![0].reference).toMatchObject({ preset: 'credit_card', lengthMm: 85.6 });
        fireEvent.click(screen.getByTestId('line-add'));
        const line = spy.mock.lastCall![0].lines[0];
        expect(line).toMatchObject({ kind: 'diameter', param: 'diameter_mm' });
        expect(screen.getByTestId(`handle-${line.id}-a`)).toBeTruthy();
    });
});
