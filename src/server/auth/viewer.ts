// Stub: replaced by the R2 accounts module
/**
 * Build edit permission. Until R2 accounts land, builds are addressed by unguessable ids
 * (ADR-0008) and every holder of the id may edit, so this allows all requests.
 */
export async function assertCanEditBuild(_request: Request, _build: { id: string }): Promise<void> {
    void _request;
    void _build;
}
