/**
 * IPv4 / IPv6 CIDR parsing and matching (pure; used by the MCP client allowlist on the server
 * and by the admin form for validation). IPv4-mapped IPv6 addresses (::ffff:192.0.2.1) match
 * IPv4 ranges. A bare address means a single host (/32 or /128).
 */

export type ParsedIp = { family: 4 | 6; value: bigint };
export type ParsedCidr = ParsedIp & { prefix: number };

function parseIpv4(s: string): bigint | null {
    const parts = s.split('.');
    if (parts.length !== 4) return null;
    let v = BigInt(0);
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null;
        const n = Number(p);
        if (n > 255 || (p.length > 1 && p.startsWith('0'))) return null;
        v = (v << BigInt(8)) | BigInt(n);
    }
    return v;
}

function parseIpv6(s: string): bigint | null {
    if (!/^[0-9a-f:.]+$/i.test(s) || s.split('::').length > 2) return null;
    let tail4: bigint | null = null;
    let text = s;
    const lastColon = s.lastIndexOf(':');
    if (s.includes('.')) {
        tail4 = parseIpv4(s.slice(lastColon + 1));
        if (tail4 === null) return null;
        text = `${s.slice(0, lastColon + 1)}0:0`;
    }
    const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const missing = 8 - h.length - t.length;
    if (tail === null ? missing !== 0 : missing < 1) return null;
    const groups = [...h, ...Array<string>(tail === null ? 0 : missing).fill('0'), ...t];
    let v = BigInt(0);
    for (const g of groups) {
        if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
        v = (v << BigInt(16)) | BigInt(parseInt(g, 16));
    }
    if (tail4 !== null) v = (v & ~BigInt(0xffffffff)) | tail4;
    return v;
}

const MAPPED_PREFIX = BigInt('0xffff00000000');
const LOW32 = BigInt('0xffffffff');

export function parseIp(input: string): ParsedIp | null {
    const s = input.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const v4 = parseIpv4(s);
    if (v4 !== null) return { family: 4, value: v4 };
    const v6 = parseIpv6(s);
    if (v6 === null) return null;
    // ::ffff:a.b.c.d is an IPv4 client seen through a dual-stack socket.
    if (v6 >> BigInt(32) === MAPPED_PREFIX >> BigInt(32)) return { family: 4, value: v6 & LOW32 };
    return { family: 6, value: v6 };
}

export function parseCidr(input: string): ParsedCidr | null {
    const [addr, len, extra] = input.trim().split('/');
    if (extra !== undefined || !addr) return null;
    const ip = parseIp(addr);
    if (!ip) return null;
    const max = ip.family === 4 ? 32 : 128;
    if (len !== undefined && !/^\d{1,3}$/.test(len)) return null;
    const prefix = len === undefined ? max : Number(len);
    if (prefix > max) return null;
    return { ...ip, prefix };
}

/** Canonical text for a valid CIDR (host bits cleared), or null when invalid. */
export function normalizeCidr(input: string): string | null {
    const c = parseCidr(input);
    if (!c) return null;
    const bits = c.family === 4 ? 32 : 128;
    const mask = c.prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(c.prefix)) - BigInt(1)) << BigInt(bits - c.prefix);
    const net = c.value & mask;
    if (c.family === 4) return `${[24, 16, 8, 0].map((s) => Number((net >> BigInt(s)) & BigInt(255))).join('.')}/${c.prefix}`;
    const groups: string[] = [];
    for (let i = 7; i >= 0; i--) groups.push(((net >> BigInt(i * 16)) & BigInt(0xffff)).toString(16));
    return `${groups.join(':')}/${c.prefix}`; // uncompressed: unambiguous and stable
}

export function ipInCidr(ip: string, cidr: string): boolean {
    const a = parseIp(ip);
    const c = parseCidr(cidr);
    if (!a || !c || a.family !== c.family) return false;
    const bits = a.family === 4 ? 32 : 128;
    if (c.prefix === 0) return true;
    const shift = BigInt(bits - c.prefix);
    return a.value >> shift === c.value >> shift;
}

export function ipAllowed(ip: string, cidrs: readonly string[] | null | undefined): boolean {
    if (!cidrs) return true;
    return cidrs.some((c) => ipInCidr(ip, c));
}
