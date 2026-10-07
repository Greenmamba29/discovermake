import type { Metadata } from 'next'
import { TrackOrder } from '@/components/orders/track-order'

export const metadata: Metadata = { title: 'Track an order' }

export default function OrdersPage() {
    return <TrackOrder />
}
