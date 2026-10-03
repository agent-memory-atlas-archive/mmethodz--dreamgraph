/** Shared browser interaction only. Authority and CAS remain with each command owner. */
export const CONTEXT_MENU_CSS = `
.dg-context-target{position:relative}.dg-overflow{position:absolute;right:4px;top:4px;width:24px;height:24px;padding:0!important;opacity:0;border:1px solid transparent!important;background:transparent!important;color:inherit;cursor:pointer}.dg-context-target:hover>.dg-overflow,.dg-context-target:focus-within>.dg-overflow,.dg-overflow:focus-visible{opacity:1}.dg-context-target>strong{display:block;padding-right:25px}.dg-menu{position:fixed;z-index:10000;min-width:190px;max-width:min(310px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:4px;background:#252525;color:#e4e4e4;border:1px solid #595959;border-radius:4px;box-shadow:0 8px 24px #0009;font:12px/1.4 system-ui,sans-serif}.dg-menu button{display:block;width:100%;text-align:left;padding:6px 8px;border:0;background:transparent;color:inherit;border-radius:2px;font:inherit;cursor:pointer}.dg-menu button:hover,.dg-menu button:focus-visible{background:#3d4652;outline:1px solid #9bb5d0;outline-offset:-1px}.dg-menu button[aria-disabled=true]{color:#aaa;cursor:default}.dg-menu small{display:block;font-size:10px;color:#bbb}.dg-plan-row{position:relative}.dg-plan-row>.plan-item{width:100%;padding-right:30px}.living-plan-foldout>summary{list-style:none}.living-plan-foldout>summary::-webkit-details-marker{display:none}.living-plan-foldout>summary:before{content:'▸';display:inline-block;width:14px;color:#aaa}.living-plan-foldout[open]>summary:before{content:'▾'}@media(hover:none),(pointer:coarse){.dg-overflow{opacity:1;width:30px;height:30px}}@media(forced-colors:active){.dg-overflow{opacity:1}.dg-menu{border:1px solid ButtonText}}`;

/** This exact source is shared by Architect and the schedule workspace and tested in browsers. */
export const CONTEXT_MENU_SCRIPT = String.raw`(() => {
 'use strict';
 let menu=null,origin=null,typeBuffer='',typeAt=0;
 const nativeTarget=event=>!!event.target.closest('input,textarea,select,a,[contenteditable=true],.monaco-editor,.xterm');
 function close(restore){if(menu)menu.remove();menu=null;if(restore&&origin&&origin.isConnected)origin.focus({preventScroll:true});origin=null;}
 function open(event,actions,trigger,label){
  close(false);origin=trigger;menu=document.createElement('div');menu.className='dg-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',label||'Context actions');
  const nodes=[];let activated=false;for(const action of actions){const node=document.createElement('button');node.type='button';node.setAttribute('role','menuitem');node.tabIndex=-1;node.textContent=action.label;
   if(action.available===false){node.setAttribute('aria-disabled','true');const reason=document.createElement('small');reason.textContent=action.reason||'Unavailable for this captured view';node.append(reason);}
   node.addEventListener('click',()=>{if(action.available===false||activated)return;activated=true;close(true);const report=error=>window.dispatchEvent(new CustomEvent('dreamgraph.action.error',{detail:String(error.message||error)}));try{Promise.resolve(action.run()).catch(report);}catch(error){report(error);}});menu.append(node);nodes.push(node);
  }menu.style.left='0px';menu.style.top='0px';menu.style.opacity='0';menu.style.pointerEvents='none';document.body.append(menu);const opened=menu;
  const position=()=>{const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport;
  const width=viewport?viewport.width:document.documentElement.clientWidth,height=viewport?viewport.height:document.documentElement.clientHeight,left=viewport?viewport.offsetLeft:0,top=viewport?viewport.offsetTop:0;
  // A newly inserted fixed box can report an unzoomed initial rectangle in Chromium.
  // Fixed boxes can also expose currentCSSZoom=1 while body zoom still scales their paint.
  // Compose the actual ancestor styles before sizing and positioning it.
  let inheritedZoom=1;for(let node=menu;node;node=node.parentElement){const value=node.style.zoom||getComputedStyle(node).zoom,numeric=parseFloat(value);if(Number.isFinite(numeric)&&numeric>0)inheritedZoom*=value.endsWith('%')?numeric/100:numeric;}
  const scaleX=inheritedZoom,scaleY=scaleX;
  // CSS layout zoom scales fixed-position units; native page zoom already exposes CSS viewport units.
  menu.style.boxSizing='border-box';menu.style.minWidth=Math.min(190,Math.max(1,(width-16)/scaleX))+'px';menu.style.maxWidth=Math.min(310,Math.max(1,(width-16)/scaleX))+'px';menu.style.maxHeight=Math.max(1,(height-16)/scaleY)+'px';
  const box={width:menu.offsetWidth*scaleX,height:menu.offsetHeight*scaleY};
  menu.style.left=Math.max(left+8,Math.min(left+width-box.width-8,event.clientX||rect.left))/scaleX+'px';menu.style.top=Math.max(top+8,Math.min(top+height-box.height-8,event.clientY||rect.bottom))/scaleY+'px';
  };
  const focus=index=>{if(nodes.length){const node=nodes[(index+nodes.length)%nodes.length];if(node.offsetTop+node.offsetHeight>menu.scrollTop+menu.clientHeight)menu.scrollTop=node.offsetTop+node.offsetHeight-menu.clientHeight;else if(node.offsetTop<menu.scrollTop)menu.scrollTop=node.offsetTop;node.getBoundingClientRect();node.focus({preventScroll:true});}};
  // Let a simultaneous layout/zoom change settle before exposing/focusing the fixed box.
  requestAnimationFrame(()=>{if(menu!==opened||!opened.isConnected)return;position();menu.style.opacity='';menu.style.pointerEvents='';focus(0);});
  menu.addEventListener('keydown',e=>{const index=nodes.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key==='Tab'){close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();focus(e.key==='Home'?0:e.key==='End'?nodes.length-1:index+(e.key==='ArrowDown'?1:-1));}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();const now=Date.now();typeBuffer=now-typeAt>700?'':typeBuffer;typeAt=now;typeBuffer+=e.key.toLowerCase();const ordered=nodes.slice(index+1).concat(nodes.slice(0,index+1)),match=ordered.find(n=>n.textContent.toLowerCase().startsWith(typeBuffer));if(match)focus(nodes.indexOf(match));}});
 }
 document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target))close(false);});
 document.addEventListener('keydown',event=>{if(menu&&event.key==='Escape'){event.preventDefault();close(true);}});
 window.addEventListener('resize',()=>close(false));
 if(window.visualViewport){window.visualViewport.addEventListener('resize',()=>close(false));window.visualViewport.addEventListener('scroll',()=>close(false));}
 new MutationObserver(()=>{if(menu&&origin&&!origin.isConnected)close(false);}).observe(document.body,{childList:true,subtree:true});
 window.DreamGraphContextMenu={close,open,attach(node,capture,label){
  node.classList.add('dg-context-target');const more=document.createElement('button');more.type='button';more.className='dg-overflow';more.textContent='⋯';more.setAttribute('aria-label','Actions for '+label);more.setAttribute('aria-haspopup','menu');
  const show=event=>{event.preventDefault();event.stopPropagation();open(event,capture(),more,label+' actions');};more.addEventListener('click',show);node.append(more);
  node.addEventListener('contextmenu',event=>{if(nativeTarget(event)||String(window.getSelection()||'').trim())return;show(event);});
  node.addEventListener('keydown',event=>{if(nativeTarget(event))return;if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)show(event);});return more;
 }};
})();`;
