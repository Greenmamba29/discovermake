/**
 * A clear drawing of a kid template with the kid's own words and colour. Shown on every design
 * step (live as they choose) and as the request thumbnail for the grown-up. Pure SVG: no hooks.
 */
import type { KidDesignOptions } from '@/contracts/kids';
import type { KidColor, KidTemplateId } from '@/contracts/text-to-cad';
import { cn } from '@/lib/utils';

export const KID_COLOR_HEX: Record<KidColor, string> = {
    red: '#e5484d',
    orange: '#f76b15',
    yellow: '#ffc53d',
    green: '#30a46c',
    blue: '#0090ff',
    purple: '#8e4ec6',
    black: '#1c2024',
    white: '#ffffff',
};

export const KID_COLOR_NAMES: Record<KidColor, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', black: 'Black', white: 'White' };

/** Text colour that reads on the part colour. */
function textOn(color: KidColor): string {
    return color === 'yellow' || color === 'white' ? '#151716' : '#ffffff';
}

export function KidPreview({ template, options, className, title }: { template: KidTemplateId; options: KidDesignOptions; className?: string; title?: string }) {
    const fill = KID_COLOR_HEX[options.color];
    const ink = textOn(options.color);
    const stroke = '#151716';
    const label = options.label?.toUpperCase() ?? '';
    const fontSize = (max: number, width: number) => Math.min(max, (width / Math.max(label.length, 1)) * 1.6);
    const name = title ?? `Drawing of your ${template.replace(/_/g, ' ')}`;
    let body: React.ReactNode;
    switch (template) {
        case 'name_keychain': {
            const big = options.size === 'big';
            const w = big ? 250 : 200;
            const x = (300 - w) / 2;
            body = (
                <>
                    <circle cx={x + 26} cy={100} r={14} fill="none" stroke="#9aa0a3" strokeWidth={6} />
                    <rect x={x} y={65} width={w} height={70} rx={24} fill={fill} stroke={stroke} strokeWidth={3} />
                    <circle cx={x + 26} cy={100} r={9} fill="#f6f3ec" stroke={stroke} strokeWidth={2} />
                    <text x={x + 26 + (w - 26) / 2} y={112} textAnchor="middle" fontWeight={800} fontSize={fontSize(34, w - 60)} fill={ink} fontFamily="ui-sans-serif, system-ui">
                        {label}
                    </text>
                </>
            );
            break;
        }
        case 'bookmark': {
            const shape = options.shape ?? 'rounded';
            const top = shape === 'arrow' ? 'M110 50 L150 20 L190 50' : shape === 'star' ? 'M110 50 L150 50' : 'M110 50 Q150 30 190 50';
            body = (
                <>
                    <path d={`${top} L190 180 L150 160 L110 180 Z`} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="round" />
                    {shape === 'star' && <path d="M150 18 l8 16 18 3 -13 12 3 18 -16 -9 -16 9 3 -18 -13 -12 18 -3 z" fill={fill} stroke={stroke} strokeWidth={3} />}
                    <text x={150} y={110} textAnchor="middle" fontWeight={800} fontSize={Math.min(22, fontSize(22, 70))} fill={ink} fontFamily="ui-sans-serif, system-ui" transform="rotate(-90 150 110)">
                        {label}
                    </text>
                </>
            );
            break;
        }
        case 'phone_stand': {
            const tilt = options.angle === 'low' ? 30 : options.angle === 'tall' ? 70 : 50;
            const rad = (tilt * Math.PI) / 180;
            const bx = 150 - Math.cos(rad) * 80;
            const by = 160 - Math.sin(rad) * 110;
            body = (
                <>
                    <rect x={70} y={160} width={160} height={18} rx={6} fill={fill} stroke={stroke} strokeWidth={3} />
                    <path d={`M150 162 L${bx} ${by} L${bx + 14} ${by + 6} L164 162 Z`} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="round" />
                    <rect x={196} y={140} width={12} height={22} rx={3} fill={fill} stroke={stroke} strokeWidth={3} />
                    {label && (
                        <text x={150} y={174} textAnchor="middle" fontWeight={800} fontSize={Math.min(14, fontSize(14, 140))} fill={ink} fontFamily="ui-sans-serif, system-ui">
                            {label}
                        </text>
                    )}
                </>
            );
            break;
        }
        case 'desk_tidy': {
            const cups = options.cups ?? 3;
            const w = 64;
            const start = 150 - (cups * w) / 2;
            body = (
                <>
                    {Array.from({ length: cups }, (_, i) => (
                        <rect key={i} x={start + i * w} y={60 + (i % 2) * 18} width={w - 6} height={120 - (i % 2) * 18} rx={8} fill={fill} stroke={stroke} strokeWidth={3} />
                    ))}
                    <rect x={start - 6} y={176} width={cups * w + 6} height={12} rx={4} fill={fill} stroke={stroke} strokeWidth={3} />
                    {label && (
                        <text x={150} y={150} textAnchor="middle" fontWeight={800} fontSize={Math.min(20, fontSize(20, cups * w - 20))} fill={ink} fontFamily="ui-sans-serif, system-ui">
                            {label}
                        </text>
                    )}
                </>
            );
            break;
        }
        case 'bike_hook': {
            body = (
                <>
                    <rect x={100} y={30} width={100} height={70} rx={10} fill={fill} stroke={stroke} strokeWidth={3} />
                    <path d="M150 100 L150 140 Q150 175 185 175 Q205 175 205 155" fill="none" stroke={fill} strokeWidth={18} strokeLinecap="round" />
                    <path d="M150 100 L150 140 Q150 175 185 175 Q205 175 205 155" fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" opacity={0.35} />
                    <circle cx={120} cy={48} r={5} fill="#f6f3ec" stroke={stroke} strokeWidth={2} />
                    <circle cx={180} cy={48} r={5} fill="#f6f3ec" stroke={stroke} strokeWidth={2} />
                    {label && (
                        <text x={150} y={80} textAnchor="middle" fontWeight={800} fontSize={Math.min(18, fontSize(18, 80))} fill={ink} fontFamily="ui-sans-serif, system-ui">
                            {label}
                        </text>
                    )}
                </>
            );
            break;
        }
    }
    return (
        <svg viewBox="0 0 300 200" role="img" aria-label={name} className={cn('h-auto w-full', className)} data-testid="kid-preview">
            <rect x={0} y={0} width={300} height={200} rx={20} fill="#fffdf8" />
            {body}
        </svg>
    );
}
