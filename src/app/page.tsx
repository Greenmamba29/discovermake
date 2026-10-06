/**
 * Placeholder home. The UI agent replaces this with the R1 upload -> quote flow.
 */
export default function HomePage() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0c0e0d] px-4 text-center text-[#e8e8f0]">
            <h1 className="text-4xl font-black tracking-tight">DiscoverMake</h1>
            <p className="text-lg text-gray-400">Discover. Make. Build.</p>
            <p className="max-w-md text-sm text-gray-500">
                Upload a DXF, get an instant binding quote, and have real parts cut, bent, finished and shipped by a partner shop.
            </p>
        </main>
    )
}
