/**
 * TypeScript declarations for CSS module imports
 * This allows importing CSS files without TypeScript compilation errors
 */

declare module '*.css' {
  const styles: { readonly [key: string]: string };
  export default styles;
}

declare module '*.scss' {
  const styles: { readonly [key: string]: string };
  export default styles;
}

declare module '*.sass' {
  const styles: { readonly [key: string]: string };
  export default styles;
}

declare module '*.less' {
  const styles: { readonly [key: string]: string };
  export default styles;
}