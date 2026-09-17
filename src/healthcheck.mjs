import {get} from 'node:http';
const request=get({hostname:'127.0.0.1',port:8787,path:'/health',headers:{Host:new URL(process.env.PUBLIC_ORIGIN||'http://localhost:8787').host}},response=>{response.resume();process.exit(response.statusCode===200?0:1);});
request.setTimeout(4000,()=>request.destroy());request.on('error',()=>process.exit(1));
