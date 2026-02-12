
import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(req: Request) {
    try {
        const { webhookUrl, offset, action } = await req.json();

        if (action === 'reindex_db') {
            try {
                console.log('Regenerating index...');
                // Note: This relies on the server runtime having access to 'bun' in path
                await execAsync('bun run scripts/generate-index.ts', { cwd: process.cwd() });
                await execAsync('bun run scripts/generate-index.ts', { cwd: process.cwd() });

                return NextResponse.json({ success: true, message: 'Index regenerated' });
            } catch (error) {
                console.error('Index gen failed:', error);
                return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
            }
        }

        // Check for "Import Seed" action

        if (!webhookUrl) {
            // For demo purposes, if no URL is provided, we simulate a success after a short delay
            // This allows the UI to show the "Success" state without a real Make scenario connected yet.
            // In a real env, we might require the URL or pull it from process.env
            console.log('No webhook URL provided, simulating sync...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            return NextResponse.json({ success: true, message: 'Simulated sync complete' });
        }

        // Call the actual Make.com webhook
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sync_templates',
                offset: offset || 0,
                timestamp: new Date().toISOString()
            }),
        });

        if (!response.ok) {
            throw new Error(`Make.com responded with ${response.status} `);
        }

        return NextResponse.json({ success: true, message: 'Sync trigger sent to Make.com' });

    } catch (error) {
        console.error('Sync failed:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to trigger sync' },
            { status: 500 }
        );
    }
}
