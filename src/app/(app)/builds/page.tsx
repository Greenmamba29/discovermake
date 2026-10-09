import type { Metadata } from 'next'
import { MY_BUILDS_TABS, type MyBuildsTab } from '@/contracts/account'
import { MyBuildsScreen } from '@/components/account/my-builds-screen'

export const metadata: Metadata = { title: 'My builds', robots: { index: false } }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** /builds?tab=all|created|remixed|ordered|following (workflow 09). */
export default async function MyBuildsPage({ searchParams }: Props) {
    const raw = (await searchParams).tab
    const tab = (MY_BUILDS_TABS as readonly string[]).includes(String(raw)) ? (raw as MyBuildsTab) : 'all'
    return <MyBuildsScreen initialTab={tab} />
}
