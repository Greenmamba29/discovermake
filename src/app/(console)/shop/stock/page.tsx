import type { Metadata } from 'next'
import { StockManager } from '@/components/shop/stock-manager'

export const metadata: Metadata = { title: 'Stock' }

/** Shop Console · Stock (R3 shop stock provider). */
export default function ShopStockPage() {
    return <StockManager />
}
