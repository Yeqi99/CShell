import {net} from 'electron';
import {submitFeedback} from '../shared/feedback-submit';
export function registerFeedback(handle:(name:string,fn:(input:unknown)=>Promise<unknown>)=>void){
 handle('feedback:submit',input=>submitFeedback(input,net.fetch));
}
