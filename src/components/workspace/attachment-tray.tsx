'use client';

/**
 * Attachment tray (100-1): reference images (png/jpg/webp/heic up to 15 MB) and CAD files
 * (dxf/step/stp/stl/svg up to 50 MB) on a build. Each file goes: create (signed upload URL) ->
 * PUT with progress -> complete (the server checks size and magic bytes). A DXF can be "Used
 * as a part", which runs the instant-quote flow on it and opens /parts/:partId.
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Download, FileBox, FileImage, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import {
    ATTACHMENT_ACCEPT,
    ATTACHMENT_FORMATS,
    attachmentExtension,
    defaultContentType,
    maxBytesFor,
    type BuildAttachmentView,
} from '@/contracts/workspace';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/ui/state';
import { errorMessage, putSigned } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PanelCard } from './panels';
import { attachmentsQueryKey, workspaceApi } from './workspace-api';

type Upload = { key: number; filename: string; progress: number; error: string | null; done: boolean };

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Client-side pre-check (the server checks again, including the bytes). Returns an error or null. */
export function precheckFile(file: { name: string; size: number }): string | null {
    const ext = attachmentExtension(file.name);
    const format = ATTACHMENT_FORMATS[ext];
    if (!format) return `${file.name}: .${ext || '?'} files cannot be attached. Use PNG, JPG, WebP or HEIC images, or DXF, STEP, STL or SVG files.`;
    const max = maxBytesFor(format.kind);
    if (file.size > max) return `${file.name} is ${formatBytes(file.size)}; ${format.kind === 'image' ? 'images' : 'CAD files'} can be up to ${formatBytes(max)}.`;
    if (file.size === 0) return `${file.name} is empty.`;
    return null;
}

function FileIcon({ a }: { a: BuildAttachmentView }) {
    const ext = attachmentExtension(a.filename);
    if (a.thumbnailUrl) {
        // Signed, short-lived storage URL: next/image would proxy and cache it.
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={a.thumbnailUrl} alt={`Preview of ${a.filename}`} className="h-full w-full object-cover" loading="lazy" data-testid="attachment-thumbnail" />;
    }
    const Icon = a.kind === 'image' ? FileImage : FileBox;
    return (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-fg-subtle" aria-hidden>
            <Icon className="h-7 w-7" />
            <span className="font-mono text-[10px] uppercase tracking-[0.08em]">{ext}</span>
        </span>
    );
}

export function AttachmentTray({ buildId }: { buildId: string }) {
    const qc = useQueryClient();
    const router = useRouter();
    const input = useRef<HTMLInputElement>(null);
    const list = useQuery({ queryKey: attachmentsQueryKey(buildId), queryFn: ({ signal }) => workspaceApi.attachments(buildId, signal) });
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const counter = useRef(0);

    const patch = (key: number, p: Partial<Upload>) => setUploads((us) => us.map((u) => (u.key === key ? { ...u, ...p } : u)));
    const refresh = () => qc.invalidateQueries({ queryKey: attachmentsQueryKey(buildId) });

    const uploadOne = async (file: File) => {
        const key = ++counter.current;
        const problem = precheckFile(file);
        setUploads((us) => [...us, { key, filename: file.name, progress: 0, error: problem, done: false }]);
        if (problem) return;
        try {
            const ext = attachmentExtension(file.name);
            const contentType = (file.type || defaultContentType(ext) || 'application/octet-stream').toLowerCase();
            const created = await workspaceApi.createAttachment(buildId, { filename: file.name, contentType, sizeBytes: file.size });
            await putSigned(created.upload, file, (f) => patch(key, { progress: f }));
            await workspaceApi.completeAttachment(buildId, created.attachment.id);
            patch(key, { progress: 1, done: true });
            await refresh();
            setUploads((us) => us.filter((u) => u.key !== key));
        } catch (err) {
            patch(key, { error: `${file.name}: ${errorMessage(err)}` });
        }
    };

    const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        setNotice(null);
        await Promise.all(files.map(uploadOne));
    };

    const remove = useMutation({
        mutationFn: (a: BuildAttachmentView) => workspaceApi.removeAttachment(buildId, a.id),
        onSuccess: (_r, a) => {
            setNotice(`${a.filename} removed.`);
            void refresh();
        },
    });
    const usePart = useMutation({
        mutationFn: (a: BuildAttachmentView) => workspaceApi.useAttachmentAsPart(buildId, a.id),
        onSuccess: (res) => router.push(res.url),
    });

    const attachments = list.data?.attachments ?? [];
    return (
        <PanelCard title="Files" icon={<Paperclip className="h-5 w-5" />} testId="attachment-tray">
            <p className="text-sm text-fg-muted">Reference photos and sketches (PNG, JPG, WebP, HEIC up to 15 MB) and CAD files (DXF, STEP, STL, SVG up to 50 MB). A DXF flat pattern can go straight to an instant quote.</p>
            <div className="mt-3">
                <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" onChange={onFiles} data-testid="attachment-input" aria-label="Attach images or CAD files" tabIndex={-1} />
                <Button variant="secondary" onClick={() => input.current?.click()} data-testid="attachment-add">
                    <UploadCloud className="h-4 w-4" aria-hidden />
                    Attach images or CAD files
                </Button>
            </div>

            {uploads.length > 0 && (
                <ul className="mt-4 space-y-2" aria-label="Uploads in progress">
                    {uploads.map((u) => (
                        <li key={u.key} className="rounded-xl bg-graphite-850 p-3 ring-1 ring-inset ring-graphite-700" data-testid="attachment-upload">
                            <p className="truncate text-sm font-medium">{u.filename}</p>
                            {u.error ? (
                                <p className="mt-1 flex items-start justify-between gap-2 text-sm text-ember" role="alert">
                                    <span className="min-w-0 break-words">{u.error}</span>
                                    <button type="button" className="shrink-0 text-xs text-fg-muted underline" onClick={() => setUploads((us) => us.filter((x) => x.key !== u.key))}>
                                        Dismiss
                                    </button>
                                </p>
                            ) : (
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graphite-700" role="progressbar" aria-label={`Uploading ${u.filename}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
                                    <div className="h-full rounded-full bg-signal transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {notice && (
                <p className="mt-3 text-sm text-fg-muted" role="status">
                    {notice}
                </p>
            )}
            {(remove.isError || usePart.isError) && (
                <Notice tone="error" className="mt-3">
                    {errorMessage(remove.error ?? usePart.error)}
                </Notice>
            )}

            {list.isPending ? (
                <Skeleton className="mt-4 h-24 w-full" />
            ) : list.isError ? (
                <Notice tone="error" className="mt-4">
                    {errorMessage(list.error)}
                </Notice>
            ) : attachments.length === 0 ? (
                <p className="mt-4 text-sm text-fg-subtle" data-testid="attachment-empty">
                    No files attached yet.
                </p>
            ) : (
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Attached files" data-testid="attachment-list">
                    {attachments.map((a) => (
                        <li key={a.id} className="flex gap-3 rounded-xl bg-graphite-850 p-3 ring-1 ring-inset ring-graphite-700" data-testid={`attachment-${a.id}`}>
                            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-graphite-900 ring-1 ring-graphite-700">
                                <FileIcon a={a} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium" title={a.filename}>
                                    {a.filename}
                                </p>
                                <p className="mt-0.5 text-xs text-fg-subtle">
                                    {ATTACHMENT_FORMATS[attachmentExtension(a.filename)]?.label ?? a.kind} · {formatBytes(a.sizeBytes)} · v{a.designVersion}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {a.url && (
                                        <a href={a.url} download={a.filename} className={cn('inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-fg-muted ring-1 ring-inset ring-graphite-600 hover:text-fg')} aria-label={`Download ${a.filename}`}>
                                            <Download className="h-3.5 w-3.5" aria-hidden /> Download
                                        </a>
                                    )}
                                    {a.usableAsPart && (
                                        <Button size="sm" className="h-8" onClick={() => usePart.mutate(a)} loading={usePart.isPending && usePart.variables?.id === a.id} data-testid="attachment-use-as-part">
                                            Use as a part
                                            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                                        </Button>
                                    )}
                                    <Button size="sm" variant="ghost" className="h-8" onClick={() => remove.mutate(a)} loading={remove.isPending && remove.variables?.id === a.id} aria-label={`Remove ${a.filename}`} data-testid="attachment-remove">
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                                    </Button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </PanelCard>
    );
}
