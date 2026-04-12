declare module "react-syntax-highlighter" {
  import type { ComponentType, ReactNode } from "react";

  export interface SyntaxHighlighterProps {
    language?: string;
    style?: unknown;
    customStyle?: React.CSSProperties;
    children?: ReactNode;
    [key: string]: unknown;
  }

  export const Prism: ComponentType<SyntaxHighlighterProps>;
}

declare module "react-syntax-highlighter/dist/cjs/styles/prism" {
  export const oneLight: unknown;
}
