/**
 * DiscoverMake API contracts: the single source of truth for request/response
 * shapes shared by the server modules, route handlers and the UI.
 *
 * Import from `@/contracts` (or a specific file). Contracts must stay free of
 * server-only imports so client components can use them for form validation.
 */
export * from './enums';
export * from './common';
export * from './catalog';
export * from './parts';
export * from './quotes';
export * from './checkout';
export * from './orders';
export * from './shop';
export * from './shipments';
export * from './passport';
export * from './admin';
export * from './events';
export * from './connect';
export * from './make-ai';
export * from './build-graph';
export * from './sourcing';
export * from './account';
export * from './live';
export * from './promise';
export * from './media';
