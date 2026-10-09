import{c as i}from"./LoadingSpinner-IBBR-U9x.js";/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],p=i("chevron-down",E),d=["식재료","소모품등 기타","현금입금","부식비","음료"],I=["쿠팡","네이버","계좌이체","인근매장","그외기타"],C=["인근매장","그외기타","현금입금"],r=7,N=50,R="소모품등 기타",S="쿠팡",x="그외기타",l=(s="식재료",n=S)=>({classification:s,usage:n,detail:"",amount:""}),h=12,m=s=>(Number(s.amount)||0)>0,A=s=>s.amount.trim()!==""||s.detail.trim()!=="",u=s=>A(s)?m(s)?s.detail.trim()===""?"missing-detail":null:"missing-amount":null,T=s=>u(s)!==null,U=s=>s.amount.trim()===""&&s.detail.trim()==="",D=(s,n,o)=>{const a=Array.isArray(s)?s:[],e=()=>l(n,o),t=a.map(c=>({...e(),...c}));for(;t.length<r;)t.push(e());return t};export{p as C,d as E,N as M,C as a,I as b,l as c,h as d,x as e,S as f,R as g,T as h,U as i,m as j,u as k,D as p};
