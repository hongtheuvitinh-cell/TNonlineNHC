/// <reference types="vite/client" />

declare module '@hungknguyen/docx-math-converter' {
    export function convertLatex2Math(latex: string): any;
    export function mathJaxReady(): Promise<any>;
}
