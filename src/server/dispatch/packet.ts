/**
 * Signed job packets (contract: `JobPacket` in src/contracts/shop.ts).
 *
 * Stored in `manufacturing_jobs.packet` WITHOUT `files` (download URLs are signed
 * per request and never stored). The signature covers the canonical JSON of the
 * stored packet minus `signature`:
 *
 *   signature = HMAC-SHA256(JOB_PACKET_SIGNING_SECRET, canonicalJson(packet without signature/files))
 *
 * Before the shop accepts, the console gets a REDACTED packet (files = [], shipTo = null).
 */
import type { JobPacket } from '../../contracts/shop';
import type { JobStatus } from '../../contracts/enums';
import { canonicalJson, hmacHex, safeEqual } from '../auth/tokens';
import { requireSecret } from '../env';
import { getStorage } from '../storage';

export type StoredPacket = Omit<JobPacket, 'files'>;
export type UnsignedPacket = Omit<JobPacket, 'files' | 'signature'>;

/** Job packet download links are short-lived (10 min); the console re-fetches the job for a fresh one. */
export const PACKET_FILE_URL_TTL_SECONDS = 600;

/** Statuses in which the shop sees the full packet (files + ship-to). */
const UNREDACTED_STATUSES: ReadonlySet<JobStatus> = new Set(['ACCEPTED', 'IN_PRODUCTION', 'QA_FAILED', 'QA_PASSED', 'SHIPPED', 'DELIVERED']);

export function packetSignature(packet: UnsignedPacket | StoredPacket): string {
    const { signature: _omit, ...rest } = packet as StoredPacket;
    void _omit;
    return hmacHex(requireSecret('JOB_PACKET_SIGNING_SECRET'), canonicalJson(rest));
}

export function signPacket(packet: UnsignedPacket): StoredPacket {
    return { ...packet, signature: packetSignature(packet) };
}

export function verifyPacket(packet: StoredPacket): boolean {
    return safeEqual(packetSignature(packet), packet.signature);
}

export function isPacketUnredacted(status: JobStatus): boolean {
    return UNREDACTED_STATUSES.has(status);
}

/**
 * Packet as served to the Shop Console: redacted before acceptance, otherwise with a
 * freshly signed, expiring download URL for the source DXF.
 */
export async function packetForConsole(stored: StoredPacket, status: JobStatus, part: { fileKey: string; filename: string }): Promise<JobPacket> {
    if (!isPacketUnredacted(status)) {
        return { ...stored, shipTo: null, files: [] };
    }
    const signed = await getStorage().getSignedUrl(part.fileKey, {
        method: 'GET',
        expiresInSeconds: PACKET_FILE_URL_TTL_SECONDS,
        downloadFilename: part.filename,
    });
    return {
        ...stored,
        files: [{ kind: 'SOURCE_DXF', filename: part.filename, url: signed.url, expiresAt: signed.expiresAt.toISOString() }],
    };
}

/** Packing instructions for the packet (material + finish aware). */
export function packingInstructions(opts: { materialCategory: string; finished: boolean; bent: boolean; quantity: number }): string {
    const lines: string[] = [];
    if (opts.materialCategory === 'PLASTIC') lines.push('Leave the protective film on both faces.');
    if (opts.materialCategory === 'WOOD') lines.push('Wipe off soot; interleave parts with kraft paper.');
    if (opts.materialCategory === 'METAL') lines.push(opts.finished ? 'Interleave finished parts with foam sheet; no metal-to-metal contact on coated faces.' : 'Interleave parts with paper to prevent scratching.');
    if (opts.bent) lines.push('Nest bent parts so flanges are not loaded; fill voids so parts cannot shift.');
    if (opts.quantity > 20) lines.push('Bundle in stacks of 10 and label each bundle with the order number.');
    lines.push('Put the packing slip with the order number inside the box. Minimum 2 in of padding on all sides.');
    return lines.join(' ');
}
