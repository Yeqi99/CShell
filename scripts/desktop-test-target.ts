import {isIP} from 'node:net';
import {z} from 'zod';

// Public test endpoints are personal deployment data, never repository defaults.
// These scripts require an explicitly selected target and still pin its receipt.
export const testHostSchema=z.string().trim().min(1).max(253).refine(value=>!!isIP(value)||/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(value),'Expected an IP address or hostname');
export const testPortSchema=z.number().int().min(1).max(65535);
export function desktopTestTarget(){
 return {host:testHostSchema.parse(process.env.CAGENT_TEST_HOST),port:testPortSchema.parse(Number(process.env.CAGENT_TEST_PUBLIC_MANAGEMENT_PORT))};
}
export function desktopTestDeployment(){
 const target=desktopTestTarget();
 return {host:target.host,managementPort:testPortSchema.parse(Number(process.env.CAGENT_TEST_MANAGEMENT_PORT??9998)),publicManagementPort:target.port,desktopPort:testPortSchema.parse(Number(process.env.CAGENT_TEST_DESKTOP_PORT??9999)),publicDesktopPort:testPortSchema.parse(Number(process.env.CAGENT_TEST_PUBLIC_DESKTOP_PORT))};
}
