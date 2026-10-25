import { z } from 'zod';
export const desktopLookSchema=z.object({name:z.string().max(50),theme:z.enum(['light','dark']),wallpaper:z.enum(['coast','dusk','forest','ink']),image:z.string().max(4_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional()}).strict();
export type DesktopLook=z.infer<typeof desktopLookSchema>;
export const defaultDesktopLook:DesktopLook={name:'海岸',theme:'light',wallpaper:'coast'};
export const desktopLookId=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v));
