import {z} from 'zod';
export const classroomActionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('script'),shell:z.enum(['powershell','cmd','sh']),script:z.string().trim().min(1).max(16384)}).strict(),
 z.object({kind:z.literal('environment'),variables:z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),z.string().max(8192).nullable()).refine(v=>Object.keys(v).length>0&&Object.keys(v).length<=100,'Specify 1–100 variables')}).strict(),
 z.object({kind:z.literal('model'),baseId:z.string().min(1).max(200)}).strict(),
 z.object({kind:z.literal('application'),appId:z.string().min(1).max(100)}).strict(),
]);
export type ClassroomAction=z.infer<typeof classroomActionSchema>;
export type ClassroomActionKind=ClassroomAction['kind'];
export interface ClassroomTaskTarget {id:string;identity:string;label:string;platform:string;capabilities:ClassroomActionKind[]}
export interface ClassroomTaskPlan {id:string;kind:ClassroomActionKind;expiresAt:number;targets:{id:string;label:string;identity:string;summary:string;error?:string}[]}
export type ClassroomTaskState='queued'|'running'|'succeeded'|'failed'|'cancelled'|'unknown';
export interface ClassroomTaskRow {targetId:string;label:string;state:ClassroomTaskState;message:string;startedAt?:number;finishedAt?:number}
export interface ClassroomTaskSnapshot {id:string;kind:ClassroomActionKind;createdAt:number;finishedAt?:number;cancelRequested:boolean;rows:ClassroomTaskRow[]}
export interface ClassroomTasksBridge {
 targets():Promise<ClassroomTaskTarget[]>;
 choices():Promise<{models:{id:string;label:string}[];applications:{id:string;label:string}[]}>;
 prepare(input:{targetIds:string[];action:ClassroomAction}):Promise<ClassroomTaskPlan>;
 execute(planId:string):Promise<ClassroomTaskSnapshot>;
 list():Promise<ClassroomTaskSnapshot[]>;
 cancel(taskId:string):Promise<ClassroomTaskSnapshot>;
}
