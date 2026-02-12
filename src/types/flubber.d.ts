declare module 'flubber' {
    export function interpolate(
        fromPath: string,
        toPath: string,
        options?: any
    ): (t: number) => string;
}
