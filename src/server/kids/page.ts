/** Kids mode for Server Components (pages read cookies through next/headers). */
import 'server-only';
import { cookieRequest } from '../auth/page';
import { kidModeState, type KidModeState } from './session';

export async function getPageKidState(): Promise<KidModeState> {
    return kidModeState(await cookieRequest());
}
