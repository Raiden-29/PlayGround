(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    intro: document.getElementById('introOverlay'), result: document.getElementById('resultOverlay'),
    start: document.getElementById('startBtn'), rematch: document.getElementById('rematchBtn'),
    playerHealth: document.getElementById('playerHealth'), enemyHealth: document.getElementById('enemyHealth'),
    playerStamina: document.getElementById('playerStamina'), enemyStamina: document.getElementById('enemyStamina'),
    playerHealthText: document.getElementById('playerHealthText'), enemyHealthText: document.getElementById('enemyHealthText'),
    playerStaminaText: document.getElementById('playerStaminaText'), enemyStaminaText: document.getElementById('enemyStaminaText'),
    timer: document.getElementById('timer'), combo: document.getElementById('comboToast'), message: document.getElementById('centerMessage'),
    sound: document.getElementById('soundBtn'), soundIcon: document.getElementById('soundIcon'),
    resultTitle: document.getElementById('resultTitle'), resultText: document.getElementById('resultText'),
    resultHits: document.getElementById('resultHits'), resultCombo: document.getElementById('resultCombo'), resultTime: document.getElementById('resultTime')
  };
  let W = 0, H = 0, dpr = 1, last = 0, elapsed = 0, timeLeft = 90, state = 'intro', shake = 0;
  let audioCtx = null, soundOn = true, particles = [], texts = [], combo = [], comboBest = 0, hits = 0, comboTimer = 0;
  const keys = new Set(), touch = { left:false,right:false,up:false,down:false,block:false };
  const player = makeFighter('player');
  const enemy = makeFighter('enemy');
  function rand(a,b){ return a + Math.random() * (b-a) }
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const lerp = (a,b,t) => a+(b-a)*t;
  function makeFighter(side) {
    return { side, x:side==='player'?.34:.66, z:.66, hp:100, stamina:100, facing:side==='player'?1:-1,
      action:'idle', actionTime:0, actionDur:0, hitDone:false, cooldown:0, guard:false, stun:0, vx:0, vz:0,
      walk:0, bob:0, flash:0, aiThink:rand(.4,1), aiMove:0, aiMoveZ:0, lastMove:'', color:side==='player'?'#38a9ce':'#cc4b48' };
  }
  function resize(){
    const r=canvas.getBoundingClientRect(); W=r.width; H=r.height; dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener('resize',resize); resize();
  function floorY(z){return H*(.65 + (z-.5)*.24)}
  function scaleAt(z){return .67 + z*.48}
  function fighterPoint(f){return {x:W*f.x,y:floorY(f.z),s:scaleAt(f.z)}}
  function bootAudio(){ if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)()}catch(_){}} if(audioCtx?.state==='suspended')audioCtx.resume(); }
  function tone(freq,duration,type='sine',volume=.045,slide=0){
    if(!soundOn)return; bootAudio(); if(!audioCtx)return;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain(),now=audioCtx.currentTime;
    o.type=type;o.frequency.setValueAtTime(freq,now);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(25,freq+slide),now+duration);
    g.gain.setValueAtTime(volume,now);g.gain.exponentialRampToValueAtTime(.001,now+duration);o.connect(g);g.connect(audioCtx.destination);o.start(now);o.stop(now+duration);
  }
  function impactSound(kind){tone(kind==='special'?115:kind==='kick'?90:145,.15,'triangle',.075,-70);tone(48,.12,'sine',.055,-20)}
  function announce(msg,color='#f2bd6d'){
    ui.message.textContent=msg;ui.message.style.color=color;ui.message.style.animation='none';void ui.message.offsetWidth;ui.message.style.animation='';
  }
  function showCombo(label){ui.combo.textContent=label;ui.combo.classList.add('show');clearTimeout(showCombo.timeout);showCombo.timeout=setTimeout(()=>ui.combo.classList.remove('show'),900)}
  function reset(){
    Object.assign(player,makeFighter('player'));Object.assign(enemy,makeFighter('enemy'));
    timeLeft=90;elapsed=0;hits=0;combo=[];comboBest=0;comboTimer=0;particles=[];texts=[];shake=0;
    ui.intro.classList.add('hidden');ui.result.classList.add('hidden');state='fight';announce('FIGHT!');tone(650,.18,'square',.045,150);
    updateHud();
  }
  ui.start.addEventListener('click',()=>{bootAudio();reset()});ui.rematch.addEventListener('click',()=>{bootAudio();reset()});
  ui.sound.addEventListener('click',()=>{soundOn=!soundOn;ui.soundIcon.textContent=soundOn?'♫':'×';ui.sound.style.opacity=soundOn?'1':'.55';if(soundOn)tone(500,.1)});
  const keyMap={a:'left',arrowleft:'left',d:'right',arrowright:'right',w:'up',arrowup:'up',s:'down',arrowdown:'down'};
  window.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase(); if([' ','arrowleft','arrowright','arrowup','arrowdown'].includes(k))e.preventDefault();
    if(k==='enter'&&state!=='fight'){bootAudio();reset();return} keys.add(k);
    if(state==='fight'&&!e.repeat){if(k==='j')attack(player,'punch');if(k==='k')attack(player,'kick');if(k==='l')attack(player,'special');if(k===' ')player.guard=true}
  });
  window.addEventListener('keyup',e=>{const k=e.key.toLowerCase();keys.delete(k);if(k===' ')player.guard=false});
  window.addEventListener('blur',()=>{keys.clear();player.guard=false;Object.keys(touch).forEach(k=>touch[k]=false)});
  document.querySelectorAll('[data-action]').forEach(btn=>{
    const action=btn.dataset.action;
    const down=e=>{e.preventDefault();bootAudio();if(['left','right','up','down'].includes(action))touch[action]=true;else if(action==='block'){touch.block=true;player.guard=true}else if(state==='fight'){attack(player,action)}};
    const up=e=>{e.preventDefault();if(['left','right','up','down'].includes(action))touch[action]=false;if(action==='block'){touch.block=false;player.guard=false}};
    btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);btn.addEventListener('pointerleave',up);
  });
  function attack(f,kind){
    if(state!=='fight'||f.stun>0||f.cooldown>0||f.action!=='idle')return;
    const cost=kind==='special'?38:kind==='kick'?20:12;if(f.stamina<cost){if(f===player)showCombo('NEED STAMINA');return}
    f.stamina-=cost; f.action=kind;f.actionTime=0;f.actionDur=kind==='punch'?.34:kind==='kick'?.52:.7;f.hitDone=false;f.cooldown=kind==='special'?.82:kind==='kick'?.49:.31;f.lastMove=kind;
    if(f===player){combo.push(kind);comboTimer=1.55;comboBest=Math.max(combo.length,comboBest);tone(kind==='special'?240:kind==='kick'?180:290,.09,'triangle',.035,65)}
  }
  function updateHud(){
    ui.playerHealth.style.width=player.hp+'%';ui.enemyHealth.style.width=enemy.hp+'%';
    ui.playerStamina.style.width=player.stamina+'%';ui.enemyStamina.style.width=enemy.stamina+'%';
    ui.playerHealthText.textContent=Math.ceil(player.hp);ui.enemyHealthText.textContent=Math.ceil(enemy.hp);
    ui.playerStaminaText.textContent=Math.ceil(player.stamina);ui.enemyStaminaText.textContent=Math.ceil(enemy.stamina);
    const sec=Math.ceil(timeLeft);ui.timer.textContent=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
  }
  function fighterUpdate(f,dt){
    f.cooldown=Math.max(0,f.cooldown-dt);f.stun=Math.max(0,f.stun-dt);f.flash=Math.max(0,f.flash-dt);f.bob+=dt*8;
    f.stamina=clamp(f.stamina+(f.guard?3.5:9)*dt,0,100);f.guard=f===player?(keys.has(' ')||touch.block):f.guard;
    if(f.action!=='idle'){
      f.actionTime+=dt;if(!f.hitDone&&f.actionTime>f.actionDur*(f.action==='special'?.47:.38)){f.hitDone=true;resolveHit(f)}
      if(f.actionTime>=f.actionDur){if(f===player&&combo.length>1&&comboTimer>0){const seq=combo.join(',');if(seq==='punch,punch,kick')showCombo('1–2 · BODY KICK!');else if(seq==='kick,punch,punch')showCombo('COUNTER COMBO!');else showCombo(combo.length+' HIT COMBO!')}f.action='idle';f.guard=false}
    }
    if(f===enemy)ai(dt);
    if(f===player){
      let mx=(keys.has('d')||keys.has('arrowright')||touch.right?1:0)-(keys.has('a')||keys.has('arrowleft')||touch.left?1:0);
      let mz=(keys.has('s')||keys.has('arrowdown')||touch.down?1:0)-(keys.has('w')||keys.has('arrowup')||touch.up?1:0);
      const speed=(f.guard?0.31:.56)*dt;f.x+=mx*speed;f.z+=mz*speed*.66;f.walk=Math.abs(mx)+Math.abs(mz);
    }
    f.x=clamp(f.x,.14,.86);f.z=clamp(f.z,.46,.91);f.facing=f.x<enemy.x?1:-1;
  }
  function ai(dt){
    const dx=player.x-enemy.x,dz=player.z-enemy.z,dist=Math.hypot(dx,dz*1.35);enemy.aiThink-=dt;enemy.walk=0;
    if(enemy.stun>0||enemy.action!=='idle')return;
    if(enemy.aiThink<=0){
      enemy.aiThink=rand(.27,.65);
      if(dist>.23){enemy.aiMove=1;enemy.aiMoveZ=Math.sign(dz)*rand(.3,.75)}
      else if(dist<.115&&Math.random()<.48){enemy.aiMove=-.5;enemy.aiMoveZ=rand(-.4,.4)}
      else if(dist<.34){enemy.aiMove=0;enemy.aiMoveZ=rand(-.35,.35);if(Math.random()<.57){const roll=Math.random();attack(enemy,roll<.49?'punch':roll<.86?'kick':'special')}}
    }
    enemy.x+=Math.sign(dx)*enemy.aiMove*.36*dt;enemy.z+=enemy.aiMoveZ*.3*dt;enemy.walk=Math.abs(enemy.aiMove)+Math.abs(enemy.aiMoveZ);
    enemy.guard=dist<.26&&player.action!=='idle'&&Math.random()<.48;
  }
  function resolveHit(attacker){
    const target=attacker===player?enemy:player;
    const reach=attacker.action==='punch'?.24:attacker.action==='kick'?.33:.38;
    const dx=target.x-attacker.x,dz=target.z-attacker.z,dist=Math.hypot(dx,dz*1.2);
    if(dist>reach||Math.abs(dz)>.25)return;
    const blocking=target.guard&&target.stamina>2;const damage=(attacker.action==='punch'?7:attacker.action==='kick'?12:attacker.stamina<10?17:19)*(blocking?.24:1)*rand(.88,1.12);
    target.hp=clamp(target.hp-damage,0,100);target.stamina=clamp(target.stamina-(blocking?7:4),0,100);target.flash=.18;target.stun=blocking?.08:attacker.action==='special'?.42:.18;
    const shove=(blocking?.025:.075)*(attacker.action==='special'?1.5:1);target.x+=Math.sign(dx)*shove;shake=blocking?3:attacker.action==='special'?13:7;
    const p=fighterPoint(target);popText(blocking?'BLOCK!':attacker.action==='special'?'K.O. POWER':attacker.action==='kick'?'CRACK!':'THUD',p.x,p.y-95*p.s,blocking?'#8fdcff':'#ffce78');
    burst(p.x,p.y-45*p.s,blocking?'#82d6ef':attacker===player?'#efbd73':'#e85a51',blocking?8:15);impactSound(attacker.action);
    if(attacker===player){hits++;const names={punch:'CLEAN SHOT',kick:'BODY KICK',special:'VOLT STRIKE'};showCombo(names[attacker.action]);}
    if(target.hp<=0){finish(attacker===player?'player':'enemy','KNOCKOUT');return}
    updateHud();
  }
  function finish(winner,reason){
    if(state!=='fight')return;state='result';ui.resultTitle.textContent=reason;ui.resultTitle.style.color=winner==='player'?'#f5bd67':'#ed6a62';
    ui.resultText.textContent=winner==='player'?'Maya “Volt” Reyes takes the win.':'Niko “The Wall” Petrov takes the win.';
    ui.resultHits.textContent=hits;ui.resultCombo.textContent=comboBest;const elapsedFight=90-timeLeft;ui.resultTime.textContent=Math.floor(elapsedFight/60)+':'+String(Math.floor(elapsedFight%60)).padStart(2,'0');
    setTimeout(()=>ui.result.classList.remove('hidden'),500);announce(reason,winner==='player'?'#f5bd67':'#ef7168');
  }
  function tick(dt){
    if(state!=='fight')return;timeLeft=Math.max(0,timeLeft-dt);if(timeLeft===0){finish(player.hp>=enemy.hp?'player':'enemy','DECISION');return}
    if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=[]}
    fighterUpdate(player,dt);fighterUpdate(enemy,dt);updateHud();
    particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=140*dt;p.life-=dt});particles=particles.filter(p=>p.life>0);
    texts.forEach(t=>{t.y-=28*dt;t.life-=dt});texts=texts.filter(t=>t.life>0);shake=Math.max(0,shake-34*dt);
  }
  function frame(now){const dt=Math.min(.033,(now-last)/1000||0);last=now;elapsed+=dt;tick(dt);draw();requestAnimationFrame(frame)}
  requestAnimationFrame(frame);
  function polygon(points,fill,stroke=null,width=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}}
  function ellipse(x,y,rx,ry,fill,stroke=null){ctx.beginPath();ctx.ellipse(x,y,Math.max(0,rx),Math.max(0,ry),0,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
  function drawBackground(){
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#14171c');sky.addColorStop(.48,'#32343a');sky.addColorStop(.76,'#22252a');sky.addColorStop(1,'#0d1014');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    // Arena haze and overhead fight-night lamps
    const glow=ctx.createRadialGradient(W*.5,H*.29,4,W*.5,H*.29,W*.65);glow.addColorStop(0,'#92919a26');glow.addColorStop(1,'#16171b00');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H*.74);
    for(let i=0;i<5;i++){const lx=W*(.12+i*.19),ly=H*.07;ctx.save();ctx.globalAlpha=.085;ctx.fillStyle=i%2?'#e4d4bd':'#bdddf3';ctx.beginPath();ctx.moveTo(lx-8,ly+8);ctx.lineTo(lx-75,H*.68);ctx.lineTo(lx+105,H*.68);ctx.lineTo(lx+8,ly+8);ctx.fill();ctx.restore();ellipse(lx,ly,13,3,'#fff4d8');}
    // Crowd tiers with randomized silhouette dots
    const seed=(i)=>{const n=Math.sin(i*127.1+3.2)*43758.5453;return n-Math.floor(n)};
    for(let row=0;row<3;row++){const y=H*(.31+row*.065);ctx.fillStyle=['#202329','#191c21','#15181d'][row];ctx.fillRect(0,y,W,H*.07);for(let i=0;i<Math.ceil(W/13);i++){const x=i*13+seed(i+row*200)*6,yy=y+seed(i*4+row*300)*24;const colors=['#34383f','#44383a','#303b43','#514842','#272b31'];ellipse(x,yy,seed(i*3+row)*3+2,seed(i*7+row)*5+3,colors[Math.floor(seed(i+100*row)*colors.length)]);}}
    ctx.fillStyle='#111418';ctx.fillRect(0,H*.48,W,H*.18);
    // cage fence
    const top=H*.34,base=H*.71;ctx.save();ctx.strokeStyle='#aab4bc2f';ctx.lineWidth=1;
    for(let i=-5;i<W+30;i+=25){ctx.beginPath();ctx.moveTo(i,top);ctx.lineTo(i-24,base);ctx.stroke()}
    ctx.strokeStyle='#bdc5cc25';for(let j=0;j<7;j++){const y=top+(base-top)*j/6;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
    ctx.restore();
    // Octagon mat
    const vanX=W*.5,vanY=H*.57;ctx.save();ctx.shadowColor='#000';ctx.shadowBlur=25;polygon([[W*.18,vanY],[W*.31,H*.53],[W*.69,H*.53],[W*.82,vanY],[W*.74,H*.78],[W*.26,H*.78]],'#c5c0b4','#dad4c7',2);ctx.restore();
    const matGrad=ctx.createLinearGradient(0,H*.54,0,H*.79);matGrad.addColorStop(0,'#cbc7bd');matGrad.addColorStop(1,'#8e8d88');polygon([[W*.18,vanY],[W*.31,H*.53],[W*.69,H*.53],[W*.82,vanY],[W*.74,H*.78],[W*.26,H*.78]],matGrad,'#ece8db',2);
    // Mat markings and sponsor-style insignia
    ctx.save();ctx.globalAlpha=.18;ctx.strokeStyle='#43454a';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(W*.5,H*.655,W*.105,H*.075,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(W*.31,H*.53);ctx.lineTo(W*.26,H*.78);ctx.moveTo(W*.69,H*.53);ctx.lineTo(W*.74,H*.78);ctx.stroke();
    ctx.translate(W*.5,H*.65);ctx.rotate(-.07);ctx.fillStyle='#36383b';ctx.font=`900 ${Math.max(15,W*.028)}px Barlow Condensed`;ctx.textAlign='center';ctx.fillText('IRON CIRCUIT',0,4);ctx.restore();
    // Posts, red/blue corner pads, and cage rails
    ctx.lineWidth=4;ctx.strokeStyle='#d5d9dc66';ctx.beginPath();ctx.moveTo(W*.18,vanY);ctx.lineTo(W*.26,H*.78);ctx.moveTo(W*.82,vanY);ctx.lineTo(W*.74,H*.78);ctx.stroke();
    polygon([[W*.175,vanY-15],[W*.195,vanY-15],[W*.28,H*.77],[W*.258,H*.78]],'#298fb3');polygon([[W*.805,vanY-15],[W*.825,vanY-15],[W*.742,H*.78],[W*.72,H*.77]],'#bd4142');
    ctx.fillStyle='#d9d9d3';ctx.font='700 9px DM Sans';ctx.textAlign='center';ctx.fillText('BLUE',W*.215,H*.69);ctx.fillStyle='#e99a86';ctx.fillText('RED',W*.785,H*.69);
  }
  function strokeLine(a,b,c,d,width,color){ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()}
  function drawFighter(f){
    const p=fighterPoint(f),s=p.s,face=f.facing;const action=f.action,progress=action==='idle'?0:clamp(f.actionTime/f.actionDur,0,1);
    let extension=0,kickLift=0,lean=0;
    if(action==='punch'){extension=Math.sin(progress*Math.PI)*48;lean=Math.sin(progress*Math.PI)*5}
    if(action==='kick'){extension=Math.sin(progress*Math.PI)*24;kickLift=Math.sin(progress*Math.PI)*43;lean=Math.sin(progress*Math.PI)*-7}
    if(action==='special'){extension=Math.sin(progress*Math.PI)*75;kickLift=Math.sin(progress*Math.PI)*29;lean=Math.sin(progress*Math.PI)*12}
    const walking=f.walk>0?Math.sin(f.bob*2)*4*f.walk:0;const recoil=f.stun>0?Math.sin(f.bob*3)*3:0;
    ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);ctx.globalAlpha=1;
    ellipse(0,2,34,8,'#080a0c55');
    // Soft spotlight silhouette, pads and foot shadows
    const skin=f.side==='player'?'#bc8467':'#ba856d', top=f.side==='player'?'#19a1c9':'#bd363c', shorts=f.side==='player'?'#116581':'#31343b';
    ctx.translate(lean*face+recoil,0);ctx.scale(face,1);
    // far leg
    strokeLine(-8, -39, -15-walking,-9,12,'#765c54');strokeLine(-15-walking,-9,-18-walking,0,10,'#d7d4cf');
    strokeLine(7,-39,8+extension*.25,-11-kickLift,15,'#895f50');strokeLine(8+extension*.25,-11-kickLift,17+extension*.34,-3-kickLift,10,'#e0ddd7');
    // torso, shorts, arm cross guard
    polygon([[-14,-82],[10,-85],[18,-48],[12,-37],[-12,-38],[-19,-50]],f.flash>0?'#f7e9d8':top,'#15191d',2);
    // chest panel and waist belt
    polygon([[-10,-78],[9,-79],[13,-51],[-10,-52]],f.side==='player'?'#62c6df':'#e36860');
    polygon([[-14,-49],[13,-51],[17,-36],[8,-32],[-15,-36]],shorts,'#1b1d21',2);
    ctx.fillStyle='#d4a554';ctx.fillRect(-5,-48,8,2);
    // arms; attacking hand extends, guarding forearm rises
    const guarded=f.guard;const farHandX=guarded?12:8+extension*.2;const farHandY=guarded?-88:-66;
    strokeLine(-12,-75,-22,-62,10,skin);strokeLine(-22,-62,-18,-47,9,skin);ellipse(-17,-44,8,7,'#eee8df','#3c3330');
    let nearX=14,nearY=-60;
    if(action==='punch'){nearX=19+extension;nearY=-68-Math.sin(progress*Math.PI)*4}
    if(action==='special'){nearX=19+extension;nearY=-72-Math.sin(progress*Math.PI)*10}
    if(guarded){nearX=12;nearY=-91}
    strokeLine(11,-75,farHandX,farHandY,11,skin);ellipse(farHandX,farHandY,8,7,'#f1ede5','#423833');
    strokeLine(12,-70,nearX,nearY,12,skin);ellipse(nearX,nearY,9,8,'#e9e5df','#382f2b');
    if(action==='kick'||action==='special'){
      // striking shin and ankle, drawn over the body for a clear kick silhouette
      strokeLine(7,-39,25+extension,-53-kickLift*.48,15,'#a8755f');strokeLine(25+extension,-53-kickLift*.48,40+extension,-49-kickLift*.5,12,'#e7e4dc');
      ellipse(41+extension,-49-kickLift*.5,8,5,'#f1eee8');
    }
    // neck and face
    ctx.fillStyle=skin;ctx.fillRect(-5,-91,10,12);ellipse(0,-101,14,16,skin,'#282425');
    // hair/headgear and facial profile facing right
    if(f.side==='player'){
      ctx.fillStyle='#251e1c';ctx.beginPath();ctx.arc(-1,-105,14,Math.PI,Math.PI*1.93);ctx.lineTo(13,-104);ctx.lineTo(6,-111);ctx.lineTo(-8,-109);ctx.fill();
    }else{
      ctx.fillStyle='#453b38';ctx.beginPath();ctx.arc(0,-105,14,Math.PI,Math.PI*2);ctx.fill();
    }
    ellipse(9,-99,1.8,1.8,'#171514');strokeLine(8,-94,13,-93,1.2,'#67473f');
    // cheek stripe/headband
    if(f.side==='player'){ctx.fillStyle='#e5c16e';ctx.fillRect(-13,-106,24,3)}else{ctx.fillStyle='#d8d1c5';ctx.fillRect(-12,-108,24,2)}
    // glove wraps, shin tape
    ctx.fillStyle=f.side==='player'?'#e5bf68':'#e8e4de';ctx.fillRect(nearX-5,nearY-3,8,2);ctx.fillRect(-20,-12,9,2);
    // action energy slash and guard effect
    if(action==='special'&&progress>.18&&progress<.8){ctx.globalAlpha=.5;ctx.strokeStyle='#67e1f3';ctx.lineWidth=8;ctx.beginPath();ctx.arc(15,-68,37,-.9,.8);ctx.stroke();ctx.globalAlpha=1}
    if(f.guard){ctx.globalAlpha=.35;ctx.strokeStyle='#81d8f3';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-62,36,-1.3,1.3);ctx.stroke();ctx.globalAlpha=1}
    ctx.restore();
    // fighter ID floating subtle glow
    ctx.save();ctx.globalAlpha=.8;ctx.fillStyle=f.side==='player'?'#70c8e3':'#ec8077';ctx.font='700 8px DM Sans';ctx.textAlign='center';ctx.letterSpacing='1px';ctx.fillText(f.side==='player'?'VOLT':'THE WALL',p.x,p.y+18*s);ctx.restore();
  }
  function burst(x,y,color,n){for(let i=0;i<n;i++){const a=rand(0,Math.PI*2),speed=rand(35,180);particles.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed-40,life:rand(.16,.42),max:.42,color,r:rand(1,3.8)})}}
  function popText(text,x,y,color){texts.push({text,x,y,color,life:.8})}
  function drawEffects(){
    particles.forEach(p=>{ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.28);ctx.fill()});ctx.globalAlpha=1;
    texts.forEach(t=>{ctx.globalAlpha=clamp(t.life*1.7,0,1);ctx.fillStyle=t.color;ctx.font='900 16px Barlow Condensed';ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=8;ctx.fillText(t.text,t.x,t.y);ctx.shadowBlur=0});ctx.globalAlpha=1;
  }
  function draw(){
    if(!W||!H)return;ctx.clearRect(0,0,W,H);ctx.save();if(shake>0)ctx.translate(rand(-shake,shake),rand(-shake*.5,shake*.5));
    drawBackground();const fighters=[player,enemy].sort((a,b)=>a.z-b.z);fighters.forEach(drawFighter);drawEffects();ctx.restore();
    if(state==='intro'){
      // cinematic opening lighting and title ambience
      const pulse=.5+.5*Math.sin(elapsed*1.2);ctx.save();ctx.globalAlpha=.12+pulse*.05;const g=ctx.createRadialGradient(W*.5,H*.57,10,W*.5,H*.57,W*.36);g.addColorStop(0,'#f4b75955');g.addColorStop(1,'#f4b75900');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.restore();
    }
  }
})();
