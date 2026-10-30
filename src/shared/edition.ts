declare const __CSHELL_PRO__: boolean;
export const isPro = typeof __CSHELL_PRO__ !== 'undefined' && __CSHELL_PRO__;
export const productName = isPro ? 'CShell Pro' : 'CShell';
