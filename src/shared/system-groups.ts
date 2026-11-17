export const CLOUD_HOST_GROUP = '云端主机';
export const ACCOUNT_DEVICE_GROUP = '同账号设备';
export const systemGroups = [CLOUD_HOST_GROUP, ACCOUNT_DEVICE_GROUP];
export const isSystemGroup = (name: string) => systemGroups.includes(name);
