export const ACCOUNT_DEVICE_GROUP = '同账号设备';
export function orderSidebarGroups(names: string[], locale: string, preferred?: string) {
  return [...new Set(names)].sort((a,b)=>a===preferred?-1:b===preferred?1:a.localeCompare(b,locale));
}
export function readGroupExpansion(raw: string | null): Record<string, boolean> {
  try {const value=JSON.parse(raw || '{}');if(!value || typeof value!=='object' || Array.isArray(value))return {};
    return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,boolean]=>entry[0].length<300&&typeof entry[1]==='boolean'));} catch {return {};}
}
export function groupIsCollapsed(state: Record<string,boolean>, key: string, preferred?: string) {
  return state[key] ?? (preferred !== undefined && key === `group:${preferred}`);
}
