import { Client } from '@notionhq/client';

if (!process.env.NOTION_API_KEY) {
    throw new Error("Missing NOTION_API_KEY environment variable");
}

export const notion = new Client({
    auth: process.env.NOTION_API_KEY,
});

export const NOTION_DB_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_DB_ID) {
    throw new Error("Missing NOTION_DATABASE_ID environment variable");
}

// Helper to extract text from rich text
export const getRichText = (richText: any[]) => {
    return richText.map((t: any) => t.plain_text).join('');
};

// Helper to extract title
export const getTitle = (title: any[]) => {
    return title.map((t: any) => t.plain_text).join('');
};

// Helper to extract multi-select
export const getMultiSelect = (multiSelect: any[]) => {
    return multiSelect.map((o: any) => o.name);
};
