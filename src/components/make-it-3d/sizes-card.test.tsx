// @vitest-environment jsdom
/**
 * "Change sizes": one field per named size, what will change listed old -> new before anything is
 * sent, invalid values refused in plain words, only real changes submitted, and Undo.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MakeIt3dRecordView } from '@/contracts/make-it-3d';
import { SizesCard } from './sizes-card';

const RECORD: MakeIt3dRecordView = {
    version: 2,
    prompt: 'A desk cable holder with three slots',
    engine: { name: 'solidcraft', version: '0.48.1' },
    scriptSha256: 'a'.repeat(64),
    parameters: [
        { name: 'L', expression: '60 mm', value: 60, unit: 'mm', comment: 'overall length' },
        { name: 'slot', expression: '5 mm', value: 5, unit: 'mm', comment: 'cable slot width' },
    ],
    origin: 'make_ai',
    changes: [],
    geometry: { bbox_mm: [60, 24, 18], volume_mm3: 22798.2, area_mm2: 6643.5, solids: 1, sound: true },
    minWallMm: 3.5,
    warnings: [],
    attempts: 1,
    artifacts: [],
    generatedAt: '2026-11-24T00:00:00.000Z',
};

afterEach(cleanup);

describe('SizesCard', () => {
    it('shows each size with its plain label and lists changes before submitting only those', () => {
        const onSubmit = vi.fn();
        render(<SizesCard record={RECORD} nextVersion={3} busy={false} error={null} onSubmit={onSubmit} />);
        expect(screen.getByLabelText('Overall length')).toHaveProperty('value', '60 mm');
        expect(screen.getByLabelText('Cable slot width')).toHaveProperty('value', '5 mm');
        const submit = screen.getByTestId('make3d-sizes-submit');
        expect(submit).toHaveProperty('disabled', true);
        expect(screen.queryByTestId('make3d-size-changes')).toBeNull();

        fireEvent.change(screen.getByTestId('make3d-size-L'), { target: { value: '80  mm' } });
        expect(screen.getByTestId('make3d-size-changes').textContent).toContain('Overall length60 mm80 mm');
        expect(submit.textContent).toBe('Make version 3');
        fireEvent.click(submit);
        expect(onSubmit).toHaveBeenCalledWith({ L: '80 mm' });
    });

    it('refuses a value that is not a size, and Undo puts the values back', () => {
        const onSubmit = vi.fn();
        render(<SizesCard record={RECORD} nextVersion={3} busy={false} error={null} onSubmit={onSubmit} />);
        fireEvent.change(screen.getByTestId('make3d-size-slot'), { target: { value: '5mm"; rm' } });
        fireEvent.blur(screen.getByTestId('make3d-size-slot'));
        expect(screen.getByRole('alert').textContent).toContain('Use a number with its unit');
        expect(screen.getByTestId('make3d-sizes-submit')).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByTestId('make3d-sizes-reset'));
        expect(screen.getByTestId('make3d-size-slot')).toHaveProperty('value', '5 mm');
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows the engine's reason when the new size cannot be built", () => {
        render(<SizesCard record={RECORD} nextVersion={3} busy={false} error="Corners: the largest radius that fits is 2.5 mm" onSubmit={() => {}} />);
        expect(screen.getByTestId('make3d-sizes-error').textContent).toContain('largest radius that fits');
    });

    it('renders nothing for a model without named sizes', () => {
        const { container } = render(<SizesCard record={{ ...RECORD, parameters: [] }} nextVersion={3} busy={false} error={null} onSubmit={() => {}} />);
        expect(container.innerHTML).toBe('');
    });
});
