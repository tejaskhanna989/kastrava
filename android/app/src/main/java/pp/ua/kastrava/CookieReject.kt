package pp.ua.kastrava

import android.webkit.WebView

/**
 * F9 on Android (free): reject cookie banners instead of accepting them.
 * Same reject-first list as the desktop banner script, adapted to a single
 * evaluateJavascript call on every finished main frame. One shot per page,
 * MutationObserver covers late banners for 20s. Never accepts anything.
 */
object CookieReject {

    private const val JS = """(function(){
try{
if(window.__kastrava_reject_done)return;window.__kastrava_reject_done=true;
var sel=['#onetrust-reject-all-handler','#onetrust-pc-btn-handler',
'#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
'button#didomi-notice-disagree-button','#truste-consent-required',
'[data-testid="cookie-reject"]','[data-action="reject"]','.cc-deny',
'#gdpr-reject','button.js-reject-cookies',
'[aria-label="Reject cookies"]','[aria-label="Reject all cookies"]',
'[aria-label="Decline cookies"]',
'[id*="cookie"][id*="reject"]','[id*="cookie"][id*="decline"]',
'[id*="cookie"][id*="deny"]','[class*="cookie"][class*="reject"]',
'[class*="cookie"][class*="decline"]'];
var re=/^(reject( all)?|decline( all)?|deny( all)?|necessary only|essential only|save (my )?selection|confirm (my )?(selection|choices)|nur notwendige|alle ablehnen|tout refuser|rechazar( todo)?)$/;
function vis(el){if(!el||el.offsetParent===null)return false;try{var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';}catch(e){return false;}}
function sweep(){
var i,j,b;
for(i=0;i<sel.length;i++){var btns=document.querySelectorAll(sel[i]);
for(j=0;j<btns.length;j++){b=btns[j];if(vis(b)){try{b.click();}catch(e){}return true;}}}
var els=document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]');
for(i=0;i<els.length;i++){b=els[i];
var t=((b.innerText||b.value||b.getAttribute('aria-label')||'').trim().toLowerCase());
if(t&&re.test(t)&&vis(b)){try{b.click();}catch(e){}return true;}}
return false;
}
if(!sweep()){try{var m=new MutationObserver(function(){sweep();});
m.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(function(){m.disconnect();},20000);}catch(e){}}
}catch(e){}
})()"""

    fun inject(view: WebView?) {
        if (view == null) return
        try {
            view.evaluateJavascript(JS, null)
        } catch (e: Exception) { }
    }
}
