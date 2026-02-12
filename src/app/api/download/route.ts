import { NextRequest, NextResponse } from "next/server";
import { checkPurchaseStatus } from "@/lib/storage";
import { getTemplateBySlug, getTemplateJson } from "@/lib/templates";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get("templateId");
    const token = searchParams.get("token");

    if (!templateId || !token) {
        return new NextResponse("Missing parameters", { status: 400 });
    }

    try {
        // 1. Verify access (MVP: token is UID for simplicity, in production use session validation)
        const hasAccess = await checkPurchaseStatus(token, templateId);

        // Also check if it's a free template
        const template = await getTemplateBySlug(templateId);
        const isFree = template?.price === 0;

        if (!hasAccess && !isFree) {
            return new NextResponse("Unauthorized: Purchase required", { status: 403 });
        }

        // 2. Fetch the JSON content
        const jsonContent = await getTemplateJson(templateId);

        if (!jsonContent) {
            return new NextResponse("Template not found", { status: 404 });
        }

        // 3. Return as a downloadable file
        return new NextResponse(JSON.stringify(jsonContent, null, 2), {
            headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="${templateId}.json"`,
            },
        });
    } catch (error) {
        console.error("Download API Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
