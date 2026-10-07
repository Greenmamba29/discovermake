import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/state'
import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'

export default function NotFound() {
    return (
        <>
            <SiteHeader />
            <main id="main" className="flex flex-1 items-center justify-center">
                <ErrorState
                    title="Page not found"
                    message="That link does not point to anything we know. If you are looking for an order, open the link from your confirmation email."
                    action={
                        <>
                            <ButtonLink href="/make">Upload a part</ButtonLink>
                            <ButtonLink href="/orders" variant="secondary">
                                Track an order
                            </ButtonLink>
                        </>
                    }
                />
            </main>
            <SiteFooter />
        </>
    )
}
