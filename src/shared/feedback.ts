import {z} from 'zod';
export const feedbackSchema=z.object({id:z.string().uuid(),message:z.string().trim().min(1).max(6000),version:z.string().max(40),platform:z.string().max(40),diagnostic:z.string().max(12000).optional(),contact:z.string().max(254).optional()}).strict();
export type FeedbackInput=z.infer<typeof feedbackSchema>;
export function redactFeedback(value:string){return value
 .replace(/("(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,'$1"[redacted]"')
 .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[redacted]@')
 .replace(/(bearer\s+)[^\s"<>]+/gi,'$1[redacted]')
 .replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[redacted]')
 .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,'$1[redacted]')
 .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[redacted private key]');}
/** Deliberately allow only machine error codes, never raw exceptions or connection data. */
export function feedbackDiagnostic(error:string){return [...new Set(error.match(/\b(?:E[A-Z]{3,30}|[A-Z]+_[A-Z_]{3,60}|HTTP [45]\d\d)\b/g)??[])].slice(0,12).join('\n');}
