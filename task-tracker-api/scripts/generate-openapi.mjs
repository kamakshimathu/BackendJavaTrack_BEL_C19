import { mkdirSync, writeFileSync } from 'node:fs';

// Static documentation source; this script is never imported by the HTTP server.
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const string = (extra = {}) => ({ type: 'string', ...extra });
const uuid = string({ format: 'uuid' });
const date = string({ format: 'date-time' });
const nullable = (schema) => ({ ...schema, nullable: true });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const schemas = {};
schemas.User = object({ id: uuid, name: string(), email: string({ format: 'email' }), createdAt: date, updatedAt: date });
schemas.UserSummary = object({ id: uuid, name: string() });
schemas.Team = object({ id: uuid, name: string(), description: nullable(string()), ownerId: uuid, createdAt: date, updatedAt: date });
schemas.TeamWithRole = object({ ...schemas.Team.properties, role: string({ enum: ['OWNER','ADMIN','MEMBER'] }) });
schemas.Member = object({ id: uuid, teamId: uuid, userId: uuid, role: string({ enum: ['OWNER','ADMIN','MEMBER'] }), joinedAt: date, user: ref('User') });
schemas.Project = object({ id: uuid, teamId: uuid, name: string(), description: nullable(string()), createdById: uuid, createdAt: date, updatedAt: date });
schemas.Invitation = object({ id: uuid, teamId: uuid, invitedEmail: string({format:'email'}), invitedById: uuid,
  status: string({enum:['PENDING','ACCEPTED','DECLINED','EXPIRED']}), expiresAt: date, createdAt: date, respondedAt: nullable(date) });
schemas.ListedInvitation = object({ ...schemas.Invitation.properties, team: object({id:uuid,name:string()}) });
schemas.TaskStatus = string({enum:['TODO','IN_PROGRESS','COMPLETED']});
schemas.TaskPriority = string({enum:['LOW','MEDIUM','HIGH','URGENT']});
schemas.Task = object({ id:uuid,title:string(),description:nullable(string()),status:ref('TaskStatus'),priority:ref('TaskPriority'),
  dueDate:nullable(date),completedAt:nullable(date),projectId:uuid,assignedToId:nullable(uuid),createdById:uuid,createdAt:date,updatedAt:date,
  assignedTo:{...schemas.UserSummary,nullable:true},createdBy:ref('UserSummary') });
schemas.Comment = object({id:uuid,taskId:uuid,authorId:uuid,content:string(),createdAt:date,updatedAt:date,author:ref('UserSummary')});
schemas.Attachment = object({id:uuid,taskId:uuid,uploadedById:uuid,originalName:string(),mimeType:string({enum:['application/pdf','image/png','image/jpeg','text/plain']}),
  sizeBytes:{type:'integer',minimum:1,maximum:5242880},createdAt:date,uploadedBy:ref('UserSummary'),downloadUrl:string()});
schemas.Tokens = object({tokenType:string({enum:['Bearer']}),accessToken:string(),expiresIn:{type:'integer',minimum:60,maximum:900},refreshToken:string(),refreshExpiresAt:date});
schemas.Error = object({error:object({message:string()})});
schemas.Pagination = object({page:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:100},total:{type:'integer',minimum:0}});
schemas.Health = object({status:string({enum:['ok','unavailable']}),database:string({enum:['connected','disconnected']}),timestamp:date});
const name = string({ minLength:1,maxLength:100,description:'Trimmed; cannot be whitespace only.' });
const description = nullable(string({maxLength:2000}));
schemas.CreateDetails = object({name,description},['name']);
schemas.UpdateDetails = {...object({name,description},[]),minProperties:1};
schemas.Register = object({name,email:string({format:'email',maxLength:254}),password:string({minLength:12,maxLength:128,writeOnly:true,
  description:'Requires lowercase, uppercase, digit and non-alphanumeric; never trimmed.'})});
schemas.Login = object({email:string({format:'email',maxLength:254}),password:string({minLength:1,maxLength:128,writeOnly:true})});
schemas.Refresh = object({refreshToken:string({pattern:'^[A-Za-z0-9_-]{43}$',writeOnly:true})});
schemas.ProfileUpdate = object({name});
schemas.RoleUpdate = object({role:string({enum:['ADMIN','MEMBER']})});
schemas.Invite = object({email:string({format:'email',maxLength:254})});
const taskFields = {title:string({minLength:1,maxLength:200,description:'Trimmed; cannot be whitespace only.'}),description:nullable(string({maxLength:5000})),
  priority:ref('TaskPriority'),dueDate:{...nullable(date),description:'Valid timezone-qualified ISO datetime; normalized to UTC milliseconds.'}};
schemas.TaskCreate = object({...taskFields,assignedToId:{...nullable(uuid),description:'Null/omitted is unassigned. A non-null value requires OWNER/ADMIN.'}},['title']);
schemas.TaskUpdate = {...object(taskFields,[]),minProperties:1};
schemas.AssigneeUpdate = object({assignedToId:nullable(uuid)});
schemas.StatusUpdate = object({status:ref('TaskStatus')});
schemas.CommentWrite = object({content:string({minLength:1,maxLength:5000,description:'Trimmed plain text; whitespace-only rejected.'})});
const wrap = (key,model) => object({[key]:ref(model)});
const pageResponse = (key,model) => object({[key]:{type:'array',items:ref(model)},pagination:ref('Pagination')});
const json = (schema,description='Successful response') => ({description,content:{'application/json':{schema}}});
const query = (name,schema,description) => ({in:'query',name,required:false,schema,...(description?{description}:{})});
const pagination = [query('page',{type:'integer',minimum:1,maximum:100000,default:1}),query('limit',{type:'integer',minimum:1,maximum:100,default:20})];
const taskQuery = [...pagination,query('status',ref('TaskStatus')),query('priority',ref('TaskPriority')),
  query('search',string({minLength:1,maxLength:200}),'Case-insensitive literal title/description substring; LIKE wildcards are escaped.'),
  query('sortBy',string({enum:['createdAt','updatedAt','dueDate','priority','status'],default:'createdAt'}),'UUID ascending breaks ties; null due dates last in both directions.'),
  query('sortOrder',string({enum:['asc','desc'],default:'desc'}))];
const paths = {};
function add(path,method,summary,{schema,status=200,body,parameters=[],publicRoute=false,description='',errors=[]}={}) {
  const params=[...path.matchAll(/\{(\w+)\}/g)].map((match)=>({in:'path',name:match[1],required:true,schema:uuid}));
  const responses={[status]:status===204?{description:'No content'}:json(schema)};
  for(const code of new Set([400,500,...(publicRoute?[]:[401]),...errors]))responses[code]=json(ref('Error'),`HTTP ${code}; consistent safe JSON error`);
  const operation={summary,description,parameters:[...params,...parameters],responses};
  if(publicRoute)operation.security=[];
  if(body)operation.requestBody={required:true,content:{'application/json':{schema:ref(body)}}};
  (paths[path]??={})[method]=operation;
}
add('/api/health','get','Database connectivity health',{schema:ref('Health'),publicRoute:true});
paths['/api/health'].get.responses[503]=json(ref('Health'),'Database unavailable; no connection details');
add('/api/auth/register','post','Register a user',{schema:wrap('user','User'),status:201,body:'Register',publicRoute:true,errors:[409,429]});
add('/api/auth/login','post','Log in',{schema:ref('Tokens'),body:'Login',publicRoute:true,errors:[401,429],description:'Same 401 message for missing account and incorrect password. Refresh token is returned only here and on rotation.'});
add('/api/auth/refresh','post','Rotate a refresh token',{schema:ref('Tokens'),body:'Refresh',publicRoute:true,errors:[401,429],description:'Every successful refresh consumes its token. Reuse revokes the entire login family. Clients must serialize refreshes.'});
add('/api/auth/logout','post','Revoke a refresh family',{status:204,body:'Refresh',publicRoute:true,errors:[429],description:'Unknown/already revoked well-formed tokens return 204. Existing access JWTs remain valid until expiry.'});
add('/api/users/me','get','Current profile',{schema:wrap('user','User')});
add('/api/users/me','patch','Update current profile name',{schema:wrap('user','User'),body:'ProfileUpdate'});
add('/api/teams','post','Create team and OWNER membership',{schema:wrap('team','TeamWithRole'),status:201,body:'CreateDetails'});
add('/api/teams','get','List my teams',{schema:pageResponse('teams','TeamWithRole'),parameters:pagination});
add('/api/teams/{teamId}','get','View team as a current member',{schema:wrap('team','TeamWithRole'),errors:[404]});
add('/api/teams/{teamId}','patch','Update team as OWNER/ADMIN',{schema:wrap('team','Team'),body:'UpdateDetails',errors:[403,404]});
add('/api/teams/{teamId}/members','get','List team members',{schema:pageResponse('members','Member'),parameters:pagination,errors:[404]});
add('/api/teams/{teamId}/members/{userId}','patch','OWNER changes MEMBER/ADMIN role',{schema:wrap('member','Member'),body:'RoleUpdate',errors:[403,404]});
add('/api/teams/{teamId}/members/{userId}','delete','Remove member or MEMBER leaves',{status:204,errors:[403,404],description:'OWNER cannot be removed. ADMIN removes MEMBER only, including no ADMIN self-removal. Removal atomically clears assignments in this team.'});
add('/api/teams/{teamId}/invitations','post','OWNER/ADMIN invites an existing account',{schema:wrap('invitation','Invitation'),status:201,body:'Invite',errors:[403,404,409],description:'Normalized account email, seven-day expiry; no email delivery or mailbox verification.'});
add('/api/invitations','get','List invitations matching current account email',{schema:pageResponse('invitations','ListedInvitation'),parameters:pagination,description:'Overdue PENDING invitations appear EXPIRED without read-time database writes.'});
for(const action of ['accept','decline'])add(`/api/invitations/{invitationId}/${action}`,'post',`${action} intended invitation`,{schema:wrap('invitation','Invitation'),errors:[404,409],description:'Empty body or {} only. Accept creates MEMBER atomically; repeated accept is 409. Repeated decline returns the same declined record.'});
add('/api/teams/{teamId}/projects','post','OWNER/ADMIN creates project',{schema:wrap('project','Project'),status:201,body:'CreateDetails',errors:[403,404]});
add('/api/teams/{teamId}/projects','get','List authorized team projects',{schema:pageResponse('projects','Project'),parameters:pagination,errors:[404]});
add('/api/projects/{projectId}','get','View project',{schema:wrap('project','Project'),errors:[404]});
add('/api/projects/{projectId}','patch','OWNER/ADMIN updates project',{schema:wrap('project','Project'),body:'UpdateDetails',errors:[403,404]});
add('/api/projects/{projectId}/tasks','post','Create task as a current member',{schema:wrap('task','Task'),status:201,body:'TaskCreate',errors:[403,404,422]});
add('/api/projects/{projectId}/tasks','get','Filter project tasks',{schema:pageResponse('tasks','Task'),parameters:[...taskQuery,query('assignedToId',{oneOf:[uuid,string({enum:['null']})]})],errors:[404]});
add('/api/tasks/assigned-to-me','get','My assignments in current teams',{schema:pageResponse('tasks','Task'),parameters:[...taskQuery,query('projectId',uuid)]});
add('/api/tasks/{taskId}','get','View task',{schema:wrap('task','Task'),errors:[404]});
add('/api/tasks/{taskId}','patch','Creator or OWNER/ADMIN edits task details',{schema:wrap('task','Task'),body:'TaskUpdate',errors:[403,404]});
add('/api/tasks/{taskId}','delete','Creator or OWNER/ADMIN deletes task',{status:204,errors:[404],description:'Unknown/inaccessible/noncreator MEMBER targets return the same 404. Cascades metadata and queues durable file cleanup.'});
add('/api/tasks/{taskId}/assignee','patch','OWNER/ADMIN assigns or unassigns',{schema:wrap('task','Task'),body:'AssigneeUpdate',errors:[403,404,422]});
add('/api/tasks/{taskId}/status','patch','Creator, assignee or manager changes status',{schema:wrap('task','Task'),body:'StatusUpdate',errors:[403,404],description:'COMPLETED sets server time once; repeated completion preserves it. Reopening clears completedAt.'});
add('/api/tasks/{taskId}/comments','post','Add a comment',{schema:wrap('comment','Comment'),status:201,body:'CommentWrite',errors:[404]});
add('/api/tasks/{taskId}/comments','get','List comments chronologically',{schema:pageResponse('comments','Comment'),parameters:pagination,errors:[404]});
add('/api/comments/{commentId}','patch','Author edits own comment',{schema:wrap('comment','Comment'),body:'CommentWrite',errors:[403,404]});
add('/api/comments/{commentId}','delete','Author or OWNER/ADMIN moderates comment',{status:204,errors:[403,404]});
add('/api/tasks/{taskId}/attachments','post','Upload one private attachment',{schema:wrap('attachment','Attachment'),status:201,errors:[404,413,415,429],description:'Current membership is checked before parsing; one file, 5 MiB maximum; PDF/PNG/JPEG/UTF-8 TXT; no text form fields.'});
paths['/api/tasks/{taskId}/attachments'].post.requestBody={required:true,content:{'multipart/form-data':{schema:object({file:string({format:'binary',description:'5 MiB maximum, allowed extension/MIME/content must match.'})}),encoding:{file:{contentType:'application/pdf, image/png, image/jpeg, text/plain'}}}}};
add('/api/tasks/{taskId}/attachments','get','List attachment metadata',{schema:pageResponse('attachments','Attachment'),parameters:pagination,errors:[404]});
add('/api/attachments/{attachmentId}/download','get','Stream authorized attachment',{schema:string({format:'binary'}),errors:[404],description:'Safe attachment disposition, nosniff, no-store and sandbox CSP. Missing disk content yields controlled 500.'});
paths['/api/attachments/{attachmentId}/download'].get.responses[200]={description:'Private streamed content',headers:{'Content-Disposition':{schema:string()},'X-Content-Type-Options':{schema:string({enum:['nosniff']})}},content:Object.fromEntries(['application/pdf','image/png','image/jpeg','text/plain'].map(mime=>[mime,{schema:string({format:'binary'})}]))};
add('/api/attachments/{attachmentId}','delete','Uploader or OWNER/ADMIN deletes attachment',{status:204,errors:[403,404],description:'Logical deletion queues physical cleanup. Missing/already deleted metadata returns 404; retries do not corrupt state.'});
const api={openapi:'3.0.3',info:{title:'Task Tracking and Team Collaboration API',version:'1.0.0',description:'Airtribe assignment. All unlisted query parameters and privileged request fields are rejected. See README for operational limits.'},servers:[{url:'http://localhost:3000'}],security:[{bearerAuth:[]}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}},schemas}};
mkdirSync('docs',{recursive:true});writeFileSync('docs/openapi.json',JSON.stringify(api,null,2)+'\n');
console.log(`Generated ${Object.values(paths).reduce((sum,item)=>sum+Object.keys(item).length,0)} documented API operations.`);
