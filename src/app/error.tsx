'use client'

import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/state'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error('Unhandled runtime error:', error)
    }, [error])

    return (
        <main id="main" className="flex flex-1 items-center justify-center bg-graphite-950">
            <ErrorState
                message="This page hit an unexpected error. Your quotes and orders are safe. Try again, or start from the home page."
                action={
                    <>
                        <Button onClick={() => reset()}>
                            <RotateCcw className="h-4 w-4" aria-hidden />
                            Try again
                        </Button>
                        <ButtonLink href="/" variant="secondary">
                            Go home
                        </ButtonLink>
                    </>
                }
            />
            {error.digest && <p className="sr-only">Error reference {error.digest}</p>}
        </main>
    )
}
