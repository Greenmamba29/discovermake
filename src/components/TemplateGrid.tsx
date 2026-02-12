"use client";

import { Template } from "@/types";
import { TemplateCard } from "./TemplateCard";

interface TemplateGridProps {
    templates: Template[];
}

export function TemplateGrid({ templates }: TemplateGridProps) {
    if (!templates.length) {
        return (
            <div className="text-center py-20">
                <h3 className="text-xl text-slate-500">No templates found matching your criteria.</h3>
                <p className="text-slate-400 mt-2">Try adjusting your filters or search query.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template, idx) => (
                <TemplateCard key={template.slug} template={template} index={idx} />
            ))}
        </div>
    );
}
