import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberSiteWorkflow} from '../src/core/member-site-workflow';
test('member site plan validates host and port before producing commands',()=>{
 for(const domain of ['canp.site','evil.example','user.canp.site; reboot','user.canp.site\nfoo','user.canp.site.evil.test','-foo.canp.site'])assert.throws(()=>memberSiteWorkflow({domain,target:'saved-server'}));
 assert.throws(()=>memberSiteWorkflow({domain:'user.canp.site',target:'server',port:80}));
 const plan=memberSiteWorkflow({domain:'WWW.User.canp.site',target:'server',port:8080});
 assert.equal(plan.status,'plan-only');assert.equal(plan.domain,'www.user.canp.site');
 assert.match(JSON.stringify(plan),/127\.0\.0\.1:8080/);assert.equal(plan.steps.at(-1)?.id,'renewal');
 assert.match(plan.failurePolicy,/仅回滚本次/);
});
