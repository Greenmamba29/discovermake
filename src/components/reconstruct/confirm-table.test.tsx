// @vitest-environment jsdom
/**
 * ConfirmTable: a photo estimate never confirms a row; the buyer types a reading (mm or in),
 * sees the delta and the >10% warning, and Confirm sends exactly what was typed.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DimensionView } from '@/contracts/reconstruct';
import { ConfirmTable } from './confirm-table';

afterEach(cleanup);

const row = (over: Partial<DimensionView>): DimensionView => ({
    param: 'diameter_mm',
    label: 'Outer diameter',
    kind: 'diameter',
    hint: 'Across the widest part.',
    estimateMm: 38.4,
    estimateUncertaintyMm: 0.5,
    caliperMm: null,
    enteredValue: null,
    enteredUnit: null,
    confirmedAt: null,
    source: 'photo_estimate',
    deltaPct: null,
    deltaWarning: false,
    ...over,
});

describe('ConfirmTable', () => {
    it('keeps a row with only a photo estimate unconfirmed and the button disabled until a reading is typed', () => {
        render(<ConfirmTable rows={[row({})]} onConfirm={vi.fn()} />);
        expect(screen.getByTestId('dim-row-diameter_mm').getAttribute('data-confirmed')).toBe('false');
        expect(screen.getByTestId('dim-status-diameter_mm').textContent).toMatch(/Not confirmed/);
        expect(screen.getByTestId('dim-estimate-diameter_mm').textContent).toContain('38.40 mm');
        expect((screen.getByTestId('dim-confirm-diameter_mm') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('confirm-progress').textContent).toBe('0 of 1 confirmed');
        // Prefilling from the estimate still needs an explicit Confirm.
        fireEvent.click(screen.getByTestId('dim-prefill-diameter_mm'));
        expect((screen.getByTestId('dim-input-diameter_mm') as HTMLInputElement).value).toBe('38.4');
        expect(screen.getByTestId('dim-row-diameter_mm').getAttribute('data-confirmed')).toBe('false');
    });

    it('confirms a reading in inches as typed and shows the mm conversion', async () => {
        const onConfirm = vi.fn(async () => {});
        render(<ConfirmTable rows={[row({})]} onConfirm={onConfirm} />);
        fireEvent.change(screen.getByTestId('dim-unit-diameter_mm'), { target: { value: 'in' } });
        fireEvent.change(screen.getByTestId('dim-input-diameter_mm'), { target: { value: '1.5' } });
        expect(screen.getByText('= 38.10 mm')).toBeTruthy();
        expect(screen.getByTestId('dim-delta-diameter_mm').textContent).toBe('0.8%');
        fireEvent.click(screen.getByTestId('dim-confirm-diameter_mm'));
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('diameter_mm', 1.5, 'in'));
    });

    it('warns when the estimate is more than 10% off the reading', () => {
        render(<ConfirmTable rows={[row({ estimateMm: 44 })]} onConfirm={vi.fn()} />);
        fireEvent.change(screen.getByTestId('dim-input-diameter_mm'), { target: { value: '38.1' } });
        expect(screen.getByTestId('dim-delta-diameter_mm').textContent).toBe('15.5%');
        expect(screen.getByTestId('dim-warning-diameter_mm').textContent).toMatch(/more than 10%/);
        fireEvent.change(screen.getByTestId('dim-input-diameter_mm'), { target: { value: '41' } });
        expect(screen.queryByTestId('dim-warning-diameter_mm')).toBeNull();
    });

    it('rejects text that is not a length and shows confirmed rows with their reading', async () => {
        const onConfirm = vi.fn(async () => {});
        render(
            <ConfirmTable
                rows={[row({}), row({ param: 'height_mm', label: 'Height', estimateMm: null, caliperMm: 22, enteredValue: 22, enteredUnit: 'mm', confirmedAt: '2026-10-09T12:00:00.000Z', source: 'caliper' })]}
                onConfirm={onConfirm}
            />,
        );
        fireEvent.change(screen.getByTestId('dim-input-diameter_mm'), { target: { value: 'about 38' } });
        fireEvent.click(screen.getByTestId('dim-confirm-diameter_mm'));
        expect((await screen.findByRole('alert')).textContent).toMatch(/Type the reading as a number/);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(screen.getByTestId('dim-row-height_mm').getAttribute('data-confirmed')).toBe('true');
        expect(screen.getByTestId('dim-caliper-height_mm').textContent).toBe('22.00 mm');
        expect(screen.getByTestId('confirm-progress').textContent).toBe('1 of 2 confirmed');
    });
});
