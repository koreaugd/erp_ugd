const n=t=>{const a=String(t||"").split(`
---
METADATA:`);let i={};if(a[1])try{i=JSON.parse(a.slice(1).join(`
---
METADATA:`).trim())||{}}catch{i={}}return{visibleMemo:a[0]||"",metadata:i}},e=(t,s)=>`${t||""}
---
METADATA:
${JSON.stringify(s||{})}`;export{e as j,n as s};
