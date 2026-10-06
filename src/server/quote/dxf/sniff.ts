/**
 * Upload validation: extension + content sniffing for R1 (ASCII DXF R12–R2018).
 *
 * R1 parses DXF only. Other CAD formats get a clear, format-specific message
 * (STEP is planned for R1.5). Binary DXF is rejected with an "export as ASCII" fix.
 */

/** Accepted AutoCAD DXF versions ($ACADVER): R12 (AC1009) through R2018 (AC1032). */
export const SUPPORTED_ACAD_VERSIONS: Record<string, string> = {
    AC1009: 'R12',
    AC1012: 'R13',
    AC1014: 'R14',
    AC1015: 'R2000',
    AC1018: 'R2004',
    AC1021: 'R2007',
    AC1024: 'R2010',
    AC1027: 'R2013',
    AC1032: 'R2018',
};

export class UnsupportedFileError extends Error {
    constructor(
        message: string,
        public readonly reason: 'UNSUPPORTED_FORMAT' | 'COMING_SOON' | 'BINARY_DXF' | 'UNSUPPORTED_VERSION' | 'NOT_DXF',
    ) {
        super(message);
        this.name = 'UnsupportedFileError';
    }
}

const COMING_SOON: Record<string, string> = {
    step: 'STEP upload is coming in R1.5. For now, export a DXF flat pattern (File → Export → DXF) and upload that.',
    stp: 'STEP upload is coming in R1.5. For now, export a DXF flat pattern (File → Export → DXF) and upload that.',
};

const OTHER_FORMATS: Record<string, string> = {
    dwg: 'DWG files are not supported yet. Save as DXF (ASCII, R12–R2018) and upload that.',
    svg: 'SVG upload is not supported in R1. Export a DXF from your design tool and upload that.',
    ai: 'Adobe Illustrator files are not supported in R1. Export a DXF (File → Export → AutoCAD Interchange File) and upload that.',
    pdf: 'PDF drawings cannot be quoted. Upload the DXF your CAD tool exports.',
    stl: 'STL meshes cannot be laser cut. Upload a 2D DXF flat pattern.',
    igs: 'IGES upload is not supported. Export a DXF flat pattern and upload that.',
    iges: 'IGES upload is not supported. Export a DXF flat pattern and upload that.',
};

export function fileExtension(filename: string): string {
    const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
    return m ? m[1].toLowerCase() : '';
}

/**
 * Validate the filename an upload is created with. Throws UnsupportedFileError
 * with a buyer-facing message for anything other than `.dxf`.
 */
export function assertDxfFilename(filename: string): void {
    const ext = fileExtension(filename);
    if (ext === 'dxf') return;
    if (COMING_SOON[ext]) throw new UnsupportedFileError(COMING_SOON[ext], 'COMING_SOON');
    if (OTHER_FORMATS[ext]) throw new UnsupportedFileError(OTHER_FORMATS[ext], 'UNSUPPORTED_FORMAT');
    throw new UnsupportedFileError('R1 accepts .dxf files only (ASCII DXF, R12–R2018).', 'UNSUPPORTED_FORMAT');
}

export type DxfSniffResult = {
    /** e.g. "AC1015"; null when the file has no header (minimal R12 writers omit it). */
    acadVersion: string | null;
    releaseLabel: string;
};

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF';

function startsWithBytes(buf: Uint8Array, sig: number[]): boolean {
    if (buf.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
    return true;
}

/**
 * Magic-byte + structure sniff. Returns the decoded text on success.
 * Rejects binary DXF, STEP/ZIP/PDF/images and anything that is not a DXF group-code stream.
 */
export function sniffDxf(bytes: Uint8Array): { text: string; info: DxfSniffResult } {
    if (bytes.length === 0) throw new UnsupportedFileError('The uploaded file is empty.', 'NOT_DXF');
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('latin1');
    if (head.startsWith(BINARY_DXF_SENTINEL)) {
        throw new UnsupportedFileError('Binary DXF is not supported. Re-save the file as ASCII DXF (R12–R2018).', 'BINARY_DXF');
    }
    if (head.startsWith('ISO-10303-21')) throw new UnsupportedFileError(COMING_SOON.step, 'COMING_SOON');
    if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46])) throw new UnsupportedFileError(OTHER_FORMATS.pdf, 'UNSUPPORTED_FORMAT');
    if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
        throw new UnsupportedFileError('Compressed archives are not supported. Upload a single ASCII DXF file.', 'UNSUPPORTED_FORMAT');
    }
    if (head.startsWith('AC10')) throw new UnsupportedFileError(OTHER_FORMATS.dwg, 'UNSUPPORTED_FORMAT');
    if (/^\s*<(\?xml|svg)/i.test(head)) throw new UnsupportedFileError(OTHER_FORMATS.svg, 'UNSUPPORTED_FORMAT');
    // NUL bytes never appear in ASCII DXF.
    const probe = bytes.subarray(0, Math.min(bytes.length, 65536));
    if (probe.includes(0)) throw new UnsupportedFileError('This file is not an ASCII DXF.', 'NOT_DXF');

    // DXF is a stream of (group code, value) line pairs; the first pair is "0 / SECTION".
    const lines = head.replace(/^﻿/, '').split(/\r?\n/);
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    // Some writers emit a leading 999 comment pair.
    while (i + 1 < lines.length && lines[i].trim() === '999') i += 2;
    if (lines[i]?.trim() !== '0' || lines[i + 1]?.trim().toUpperCase() !== 'SECTION') {
        throw new UnsupportedFileError('This file is not a DXF (missing the SECTION header). Export an ASCII DXF and try again.', 'NOT_DXF');
    }

    // Decode: DXF R2007+ is UTF-8; older releases use the ANSI code page (latin1 is a safe superset for parsing).
    let text = Buffer.from(bytes).toString('utf8');
    if (text.includes('�')) text = Buffer.from(bytes).toString('latin1');
    text = text.replace(/^﻿/, '');

    if (!/\n\s*ENTITIES\s*\r?\n/i.test(text)) {
        throw new UnsupportedFileError('The DXF has no ENTITIES section, so there is no geometry to cut.', 'NOT_DXF');
    }

    const verMatch = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/i.exec(text.slice(0, 200_000));
    const acadVersion = verMatch ? verMatch[1].toUpperCase() : null;
    if (acadVersion && !SUPPORTED_ACAD_VERSIONS[acadVersion]) {
        const n = Number(acadVersion.slice(2));
        const tooOld = n < 1009;
        throw new UnsupportedFileError(
            tooOld
                ? `This DXF (${acadVersion}) is older than R12. Re-save it as DXF R12 or newer.`
                : `This DXF version (${acadVersion}) is newer than R2018. Re-save it as DXF R2018 or older.`,
            'UNSUPPORTED_VERSION',
        );
    }
    return { text, info: { acadVersion, releaseLabel: acadVersion ? SUPPORTED_ACAD_VERSIONS[acadVersion] : 'R12 (no header)' } };
}
