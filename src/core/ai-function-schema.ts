import {z} from 'zod';
/** Function APIs require an object root. Keep exact union branches and backend validation. */
export function functionParameters(input:z.ZodType): Record<string,unknown>{
 const {$schema:_,...schema}=z.toJSONSchema(input,{io:'input'});
 const branches=(schema as any).oneOf??(schema as any).anyOf;
 if(!schema.type&&Array.isArray(branches)&&branches.every((branch:any)=>branch.type==='object')){
  const properties:Record<string,any>={};
  for(const branch of branches)for(const[key,value]of Object.entries(branch.properties??{})){
   const previous=properties[key];
   if(!previous)properties[key]=value;
   else if(JSON.stringify(previous)!==JSON.stringify(value))properties[key]={anyOf:[...(previous.anyOf??[previous]),value]};
  }
  return {...schema,type:'object',properties};
 }
 return schema;
}
