
import { NextRequest, NextResponse } from 'next/server';
import { getAllTemplates } from '@/lib/templates';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const category = searchParams.get('category') || undefined;
    const complexity = searchParams.get('complexity') || undefined;

    try {
        const { templates, total } = await getAllTemplates(page, limit, search, category, complexity);

        return NextResponse.json({
            templates,
            total,
            page,
            limit,
            hasMore: total > page * limit
        });
    } catch (error: any) {
        console.error("API Templates Error:", error);
        return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
    }
}
