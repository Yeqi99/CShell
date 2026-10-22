export type AccountSource='opensource'|'guest';
export interface AccountSourcePreview {
 source:AccountSource;token:string;counts:{label:string;count:number}[];
 conflicts:{id:string;category:string;name:string}[];
}
export interface AccountImportBridge {
 guestCacheClear?(confirmation:'clear-guest-local-only'):Promise<void>;
 accountSources?():Promise<AccountSource[]>;
 accountSourcePreview?(source:AccountSource):Promise<AccountSourcePreview>;
 accountSourceImport?(token:string,settings:boolean,choices:Record<string,'account'|'source'>):Promise<void>;
}
