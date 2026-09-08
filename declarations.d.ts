declare module '@hungknguyen/mathml2omml' {
    export interface Mml2OmmlOptions {
        disableDecode?: boolean;
    }
    export function mml2omml(mml: string, options?: Mml2OmmlOptions): string;
}

declare module '@hungknguyen/docx-math-converter' {
    export function mathJaxReady(): Promise<boolean>;
    export function convertLatex2Math(latex: string): any;
}
