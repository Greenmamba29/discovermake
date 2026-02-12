
import { NextRequest, NextResponse } from 'next/server';
import { getTemplateBySlug, getTemplateJson } from '@/lib/templates';

type Props = {
    params: Promise<{ slug: string }>;
};

export async function GET(req: NextRequest, { params }: Props) {
    const { slug } = await params;

    // Validate slug (basic security)
    if (!slug || slug.includes('..') || slug.includes('/')) {
        return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
    }

    const template = await getTemplateBySlug(slug);
    const json = await getTemplateJson(slug);

    if (!template || !json) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Return as a downloadable file
    return new NextResponse(JSON.stringify(json, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${slug}.json"`,
        },
    });
}
