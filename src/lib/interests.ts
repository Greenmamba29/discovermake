import { Armchair, Bike, Bot, Box, Car, Drama, Drone, Gem, House, Lamp, Monitor, Signpost, Speaker, Sprout, Tent, Wrench, type LucideIcon } from 'lucide-react';
import { INTEREST_SLUGS, type InterestSlug } from '@/contracts/account';

/** Display labels + icons for the onboarding "Pick 5" interests (contracts/account.ts). */
export const INTERESTS: Record<InterestSlug, { label: string; icon: LucideIcon }> = {
    'brackets-mounts': { label: 'Brackets & mounts', icon: Wrench },
    enclosures: { label: 'Enclosures', icon: Box },
    signage: { label: 'Signs', icon: Signpost },
    furniture: { label: 'Furniture', icon: Armchair },
    automotive: { label: 'Automotive', icon: Car },
    robotics: { label: 'Robotics', icon: Bot },
    drones: { label: 'Drones', icon: Drone },
    'home-repair': { label: 'Home repair', icon: House },
    lighting: { label: 'Lighting', icon: Lamp },
    audio: { label: 'Audio', icon: Speaker },
    'cosplay-props': { label: 'Cosplay & props', icon: Drama },
    garden: { label: 'Garden', icon: Sprout },
    bikes: { label: 'Bikes', icon: Bike },
    camping: { label: 'Camping', icon: Tent },
    'desk-setup': { label: 'Desk setup', icon: Monitor },
    jewelry: { label: 'Jewelry', icon: Gem },
};

export const INTEREST_OPTIONS = INTEREST_SLUGS.map((slug) => ({ slug, ...INTERESTS[slug] }));

export function isInterestSlug(v: unknown): v is InterestSlug {
    return typeof v === 'string' && (INTEREST_SLUGS as readonly string[]).includes(v);
}
