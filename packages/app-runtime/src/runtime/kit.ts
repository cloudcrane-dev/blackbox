// The game kit: the script a coded component's frame runs before its code,
// giving it `game`. The page drives it: it sends a seed and the inputs once,
// then its clock (`tick`, in ms) every frame, and says when the app is hidden.
// The kit turns that clock into fixed steps at the game's rate, so a game moves
// the same way for the same time and seed, in a test with a stopped clock or on
// a phone. Touch and keys arrive as tap and swipe; the page's own buttons can
// send inputs too. Nothing reaches the page but messages over its port: the
// state when it changes, and events.
//
//   game.start({ rate, setup(), step(), draw(g, width, height) })
//   game.on("tap" | "swipe" | "input", fn)   swipe: "up" | "down" | "left" | "right"
//   game.emit(event, fields)   game.state = {...}   game.inputs   game.random()
//
// Plain ES5-style JavaScript in a string: it runs as is in the frame.

export const GAME_KIT = `(function(){"use strict";
var port=null,out=[],on={},opts=null,ready=false,begun=false,rate=10,acc=0,seed=1,last;
var cv=document.querySelector("canvas"),g=cv.getContext("2d"),W=0,H=0;
function send(m){if(port)port.postMessage(m);else out.push(m)}
function fire(n,a,b){(on[n]||[]).forEach(function(f){f(a,b)})}
function fit(){var r=Math.min(window.devicePixelRatio||1,3);W=cv.clientWidth;H=cv.clientHeight;cv.width=Math.round(W*r);cv.height=Math.round(H*r);g.setTransform(r,0,0,r,0,0)}
function report(){if(!game.state||typeof game.state!=="object")return;var s;try{s=JSON.stringify(game.state)}catch(e){return}if(s!==undefined&&s!==last){last=s;send({state:JSON.parse(s)})}}
function paint(){if(opts.draw){g.clearRect(0,0,W,H);opts.draw(g,W,H)}}
function begin(){if(begun||!ready||!opts)return;begun=true;fit();if(opts.setup)opts.setup();paint();report()}
function frame(dt){if(!begun||game.paused)return;var each=1000/rate,n=0;acc+=Math.max(0,Math.min(dt,60000));
while(acc>=each&&n<rate*60){acc-=each;n++;if(opts.step)opts.step()}if(acc>=each)acc=0;
paint();report()}
var game={inputs:{},state:null,paused:false,
start:function(o){opts=o||{};rate=Math.max(1,Math.min(60,Number(opts.rate)||10));begin()},
on:function(n,f){(on[n]=on[n]||[]).push(f)},
emit:function(n,d){send({emit:{name:String(n),data:d}})},
random:function(){seed=(seed+0x6D2B79F5)|0;var t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}};
window.game=game;
addEventListener("message",function(e){if(e.data!=="cc-port"||port||!e.ports||!e.ports[0])return;port=e.ports[0];
port.onmessage=function(m){var d=m.data||{};
if(d.init){seed=(Number(d.init.seed)|0)||1;game.inputs=d.init.inputs||{};ready=true;begin()}
if(d.input){game.inputs[d.input.name]=d.input.value;fire("input",d.input.name,d.input.value)}
if(typeof d.tick==="number")frame(d.tick);
if(typeof d.visible==="boolean")game.paused=!d.visible};
var q=out;out=[];q.forEach(send)});
addEventListener("resize",function(){if(begun){fit();paint()}});
var x0,y0,t0;
cv.addEventListener("pointerdown",function(e){x0=e.offsetX;y0=e.offsetY;t0=e.timeStamp});
cv.addEventListener("pointerup",function(e){if(x0===undefined)return;var dx=e.offsetX-x0,dy=e.offsetY-y0;
if(Math.abs(dx)<12&&Math.abs(dy)<12){if(e.timeStamp-t0<600)fire("tap",x0,y0)}
else fire("swipe",Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));x0=undefined});
var KEYS={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right"};
addEventListener("keydown",function(e){if(KEYS[e.key]){e.preventDefault();fire("swipe",KEYS[e.key])}else if(e.key===" "||e.key==="Enter"){e.preventDefault();fire("tap",W/2,H/2)}});
})();`;
