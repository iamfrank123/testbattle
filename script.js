(function () {
    console.log("Sword Arena: Final Stable Build");

    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // --- CONFIG ---
    const BALL_RADIUS = 40;
    const SWORD_LENGTH = 100;
    const SWORD_WIDTH = 10;
    const CONSTANT_SPEED = 2;
    const MAX_HP = 50;
    const DAMAGE = 5;
    const ROTATION_SPEED = 0.025;
    const HIT_COOLDOWN = 500;
    const CLASH_COOLDOWN = 250;
    const SLOW_MO_FACTOR = 0.15;
    const SLOW_MO_DECAY = 0.015;

    const BALL1_COLOR = '#ef4444';
    const BALL2_COLOR = '#22c55e';
    const SWORD_COLOR = '#e2e8f0';

    // --- STATE ---
    let globalTimeScale = 1.0;
    let balls = [];
    let gameActive = false;
    let winner = null;
    let lastClash = 0;
    let effects = [];
    let screenShake = 0;
    let flashOpacity = 0;
    let impactLines = 0;
    let isVictory = false;
    let victoryTimer = 0;

    // --- ASSETS ---
    const pianoImg = new Image();
    pianoImg.src = 'assets/piano.png';
    pianoImg.onload = () => console.log("🎹 Piano loaded.");
    pianoImg.onerror = () => console.error("❌ Piano failed.");

    const guitarImg = new Image();
    guitarImg.src = 'assets/guitar.png';
    guitarImg.onload = () => console.log("🎸 Guitar loaded.");
    guitarImg.onerror = () => console.error("❌ Guitar failed.");

    // --- AUDIO POOL ---
    const clashPool = [
        new Audio('sounds/clash.mp3'),
        new Audio('sounds/clash.mp3'),
        new Audio('sounds/clash.mp3')
    ];
    let clashIndex = 0;

    const hitPool = [
        new Audio('sounds/hit.mp3'),
        new Audio('sounds/hit.mp3'),
        new Audio('sounds/hit.mp3')
    ];
    let hitIndex = 0;

    function initAudio() {
        clashPool.forEach(a => { a.volume = 1.0; a.load(); });
        hitPool.forEach(a => { a.volume = 1.0; a.load(); });
    }

    function playClank() {
        try {
            const sound = clashPool[clashIndex];
            sound.currentTime = 0;
            sound.play().catch(e => console.warn("Clash audio play blocked."));
            clashIndex = (clashIndex + 1) % clashPool.length;
        } catch (e) {
            // Fallback synth
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        }
    }

    function playStab() {
        try {
            const sound = hitPool[hitIndex];
            sound.currentTime = 0;
            sound.play().catch(e => console.warn("Hit audio play blocked."));
            hitIndex = (hitIndex + 1) % hitPool.length;
        } catch (e) {
            // Fallback synth
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.frequency.setValueAtTime(150, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
            g.gain.setValueAtTime(0.3, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        }
    }

    // --- MATH ---
    function distToSegment(p, a, b) {
        const l2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (l2 === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
        let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.sqrt((p.x - (a.x + t * (b.x - a.x))) ** 2 + (p.y - (a.y + t * (b.y - a.y))) ** 2);
    }

    function distBetweenSegments(p1, p2, p3, p4) {
        return Math.min(
            distToSegment(p1, p3, p4),
            distToSegment(p2, p3, p4),
            distToSegment(p3, p1, p2),
            distToSegment(p4, p1, p2)
        );
    }

    // --- CLASSES ---
    // --- CLASSES ---
    class Ball {
        constructor(x, y, color, id) {
            this.id = id;
            this.x = x; this.y = y;
            this.vx = (Math.random() - 0.5) * 8;
            this.vy = (Math.random() - 0.5) * 8;
            this.radius = BALL_RADIUS;
            this.color = color;
            this.hp = MAX_HP;
            this.angle = Math.random() * Math.PI * 2;
            this.rotationDir = Math.random() > 0.5 ? 1 : -1;
            this.lastHit = 0;
            this.history = [];

            // Fire System
            this.flames = [];

            // Rage Mechanic
            this.hitTakenCount = 0;
            this.isEnraged = false;
        }

        update() {
            this.history.unshift({ x: this.x, y: this.y, angle: this.angle });
            if (this.history.length > 5) this.history.pop();
            this.x += this.vx * globalTimeScale;
            this.y += this.vy * globalTimeScale;
            this.angle += ROTATION_SPEED * this.rotationDir * globalTimeScale;
            this.normalizeVelocity();
            if (this.x - this.radius < 0) { this.x = this.radius; this.vx *= -1; }
            else if (this.x + this.radius > canvas.width) { this.x = canvas.width - this.radius; this.vx *= -1; }
            if (this.y - this.radius < 0) { this.y = this.radius; this.vy *= -1; }
            else if (this.y + this.radius > canvas.height) { this.y = canvas.height - this.radius; this.vy *= -1; }

            this.updateFlames();
        }

        updateFlames() {
            // Rage Mode: Le fiamme appaiono SOLO se la palla è arrabbiata (3 colpi subiti)
            if (!this.isEnraged) {
                // Se non è arrabbiata, non genera nuove particelle.
                // Facciamo solo il decay di quelle esistenti.
            } else {
                // 1. AURA FIAMMANTE RIDOTTA
                const auraCount = 2; // Ridotto per effetto "contenuto"
                for (let i = 0; i < auraCount; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const r = this.radius * (0.8 + Math.random() * 0.2);
                    const fx = Math.cos(a) * r;
                    const fy = Math.sin(a) * r;

                    this.flames.push({
                        x: fx, y: fy,
                        vx: Math.cos(a) * (0.5 + Math.random() * 1.0),
                        vy: Math.sin(a) * (0.5 + Math.random() * 1.0),
                        life: 1.0,
                        maxLife: 1.0,
                        size: 8 + Math.random() * 12, // Dimensioni ridotte (8-20px)
                        type: 'aura'
                    });
                }

                // 2. SPADA FIAMMANTE RIDOTTA
                const swordCount = 2;
                for (let i = 0; i < swordCount; i++) {
                    const dist = Math.random() * SWORD_LENGTH;
                    const sx = dist;
                    const sy = (Math.random() - 0.5) * SWORD_WIDTH * 1.5;

                    this.flames.push({
                        x: sx, y: sy,
                        vx: (Math.random() - 0.5) * 0.5,
                        vy: (Math.random() - 0.5) * 0.5,
                        life: 1.0,
                        maxLife: 1.0,
                        size: 4 + Math.random() * 6, // Dimensioni ridotte (4-10px)
                        type: 'sword'
                    });
                }
            }

            // Aggiorna particelle esistenti (decay)
            for (let i = this.flames.length - 1; i >= 0; i--) {
                let p = this.flames[i];
                p.life -= 0.05; // Decay rapido
                p.x += p.vx;
                p.y += p.vy;
                p.size *= 0.96; // Si rimpiccioliscono
                if (p.life <= 0) this.flames.splice(i, 1);
            }
        }

        normalizeVelocity() {
            let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (speed === 0) { this.vx = CONSTANT_SPEED; this.vy = 0; speed = CONSTANT_SPEED; }
            const min = CONSTANT_SPEED * 0.4;
            if (Math.abs(this.vx) < min) this.vx = min * (this.vx > 0 ? 1 : -1);
            if (Math.abs(this.vy) < min) this.vy = min * (this.vy > 0 ? 1 : -1);
            speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            this.vx = (this.vx / speed) * CONSTANT_SPEED;
            this.vy = (this.vy / speed) * CONSTANT_SPEED;
        }

        draw() {
            // 1. History Trails (World Space)
            this.history.forEach((h, i) => {
                ctx.save();
                ctx.globalAlpha = (5 - i) / 10 * 0.5; // Meno invasiva
                ctx.translate(h.x, h.y);
                ctx.rotate(h.angle);
                ctx.fillStyle = SWORD_COLOR;
                ctx.fillRect(0, -SWORD_WIDTH / 2, SWORD_LENGTH, SWORD_WIDTH);
                ctx.restore();
            });

            // 2. Ball & Fire (Local Space)
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);

            // --- DISEGNO FIAMME (SOFT) ---
            ctx.globalCompositeOperation = 'lighter'; // Glow

            this.flames.forEach(p => {
                const alpha = p.life * 0.4; // Molto trasparenti per sovrapposizione morbida
                if (alpha <= 0) return;

                // Creiamo un gradiente radiale per ogni particella per renderla "fumosa" e non "pallino"
                // Gradiente dal centro (colore pieno) all'esterno (trasparente)
                const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);

                if (this.id === 1) { // RED (Caldo ma profondo)
                    // Core: Arancio caldo -> Out: Rosso scuro trasparente
                    grad.addColorStop(0, `rgba(255, 200, 50, ${alpha})`);
                    grad.addColorStop(0.5, `rgba(255, 80, 0, ${alpha * 0.5})`);
                    grad.addColorStop(1, `rgba(100, 0, 0, 0)`);
                } else { // GREEN (Etereo)
                    // Core: Bianco/Lime -> Out: Verde scuro trasparente
                    grad.addColorStop(0, `rgba(200, 255, 100, ${alpha})`);
                    grad.addColorStop(0.5, `rgba(50, 200, 50, ${alpha * 0.5})`);
                    grad.addColorStop(1, `rgba(0, 50, 0, 0)`);
                }

                ctx.fillStyle = grad;
                ctx.beginPath();
                // Disegniamo un cerchio più grande del "size" visivo per contenere la sfumatura
                ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalCompositeOperation = 'source-over';

            // --- CORPO ---
            // Sword
            ctx.fillStyle = SWORD_COLOR;
            // Shadow più morbida e larga
            ctx.shadowBlur = 20;
            ctx.shadowColor = (this.id === 1) ? 'rgba(255, 100, 0, 0.8)' : 'rgba(50, 255, 50, 0.8)';
            ctx.fillRect(0, -SWORD_WIDTH / 2, SWORD_LENGTH, SWORD_WIDTH);

            // Ball Body
            ctx.shadowBlur = 40; // Aura glow di base molto ampia
            ctx.shadowColor = (this.id === 1) ? '#ff4400' : '#44ff44';
            ctx.fillStyle = this.color;
            ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill();

            // Icon
            const img = (this.id === 1) ? guitarImg : pianoImg;
            if (img.complete && img.naturalWidth > 0) {
                ctx.save();
                ctx.beginPath(); ctx.arc(0, 0, this.radius - 2, 0, Math.PI * 2); ctx.clip();
                ctx.drawImage(img, -this.radius, -this.radius, this.radius * 2, this.radius * 2);
                ctx.restore();
            } else {
                ctx.fillStyle = 'white';
                ctx.font = 'bold 30px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(this.id === 1 ? '🎸' : '🎹', 0, 10);
            }

            // Hit Flash
            if (Date.now() - this.lastHit < 100) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();

            // --- PARTE STATICA ---
            ctx.save();
            ctx.translate(this.x, this.y);
            const label = (this.id === 1) ? 'GUITAR' : 'PIANO';
            ctx.font = 'bold 12px Inter, Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const textW = ctx.measureText(label).width + 8;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.roundRect(-textW / 2, -10, textW, 20, 4);
            ctx.fill();
            ctx.fillStyle = 'white';
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }

        getBounds() {
            return {
                p1: { x: this.x, y: this.y },
                p2: { x: this.x + Math.cos(this.angle) * SWORD_LENGTH, y: this.y + Math.sin(this.angle) * SWORD_LENGTH }
            };
        }
    }

    // --- EFFECTS ---
    function spawnParticles(x, y, color, count = 10) {
        for (let i = 0; i < count; i++) {
            effects.push({ x, y, vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15, life: 1.0, size: Math.random() * 5 + 2, color });
        }
    }

    function spawnFirework() {
        const x = Math.random() * canvas.width;
        const y = Math.random() * (canvas.height * 0.7);
        const colors = ['#ef4444', '#22c55e', '#38bdf8', '#fbbf24', '#a855f7', '#ec4899', '#ffffff'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        for (let i = 0; i < 40; i++) {
            effects.push({
                x, y,
                vx: (Math.random() - 0.5) * 14,
                vy: (Math.random() - 0.5) * 14,
                life: 1.0,
                size: Math.random() * 4 + 2,
                color,
                gravity: 0.15
            });
        }
    }

    function checkCombat() {
        if (balls.length < 2) return;
        const b1 = balls[0]; const b2 = balls[1];
        const s1 = b1.getBounds(); const s2 = b2.getBounds();
        const now = Date.now();

        const d1to2 = Math.sqrt((s1.p2.x - b2.x) ** 2 + (s1.p2.y - b2.y) ** 2);
        if (d1to2 < b2.radius && now - b2.lastHit > HIT_COOLDOWN) {
            // B1 hits B2
            if (b1.isEnraged) {
                // FAIL ATTACK
                b2.hp -= 15;
                b1.isEnraged = false;
                b1.hitTakenCount = 0;
                playStab();
                screenShake = 30; // More shake
                spawnParticles(s1.p2.x, s1.p2.y, b1.color, 40); // More particles (Explosion)
                // Optional: Special sound or big visual flare
            } else {
                b2.hp -= DAMAGE;
                playStab();
                spawnParticles(s1.p2.x, s1.p2.y, b1.color);
                screenShake = 15;
            }

            b2.lastHit = now;
            b1.rotationDir *= -1;

            // Update Rage for Victim (B2)
            if (!b2.isEnraged) {
                b2.hitTakenCount++;
                if (b2.hitTakenCount >= 3) {
                    b2.isEnraged = true;
                    // Visual feedback for activation could go here (e.g. flash)
                    spawnParticles(b2.x, b2.y, 'white', 20); // Quick burst to show activation
                }
            }
        }

        const d2to1 = Math.sqrt((s2.p2.x - b1.x) ** 2 + (s2.p2.y - b1.y) ** 2);
        if (d2to1 < b1.radius && now - b1.lastHit > HIT_COOLDOWN) {
            // B2 hits B1
            if (b2.isEnraged) {
                // FAIL ATTACK
                b1.hp -= 15;
                b2.isEnraged = false;
                b2.hitTakenCount = 0;
                playStab();
                screenShake = 30;
                spawnParticles(s2.p2.x, s2.p2.y, b2.color, 40);
            } else {
                b1.hp -= DAMAGE;
                playStab();
                spawnParticles(s2.p2.x, s2.p2.y, b2.color);
                screenShake = 15;
            }

            b1.lastHit = now;
            b2.rotationDir *= -1;

            // Update Rage for Victim (B1)
            if (!b1.isEnraged) {
                b1.hitTakenCount++;
                if (b1.hitTakenCount >= 3) {
                    b1.isEnraged = true;
                    spawnParticles(b1.x, b1.y, 'white', 20);
                }
            }
        }

        if (distBetweenSegments(s1.p1, s1.p2, s2.p1, s2.p2) < (SWORD_WIDTH + 10)) {
            if (now - lastClash > CLASH_COOLDOWN) {
                playClank(); lastClash = now; globalTimeScale = SLOW_MO_FACTOR;
                b1.rotationDir *= -1; b2.rotationDir *= -1;
                screenShake = 30; flashOpacity = 0.7; impactLines = 1.0;
                spawnParticles((s1.p2.x + s2.p2.x) / 2, (s1.p2.y + s2.p2.y) / 2, 'white', 20);
                const nx = b2.x - b1.x; const ny = b2.y - b1.y; const d = Math.sqrt(nx * nx + ny * ny) || 1;
                b1.vx -= (nx / d) * 4; b1.vy -= (ny / d) * 4; b2.vx += (nx / d) * 4; b2.vy += (ny / d) * 4;
            }
        }

        const db = Math.sqrt((b1.x - b2.x) ** 2 + (b1.y - b2.y) ** 2);
        if (db < b1.radius + b2.radius) {
            const nx = (b2.x - b1.x) / db; const ny = (b2.y - b1.y) / db;
            const p = (b1.vx * nx + b1.vy * ny - b2.vx * nx - b2.vy * ny);
            b1.vx -= p * nx; b1.vy -= p * ny; b2.vx += p * nx; b2.vy += p * ny;
            const overlap = (b1.radius + b2.radius - db) / 2;
            b1.x -= nx * overlap; b1.y -= ny * overlap; b2.x += nx * overlap; b2.y += ny * overlap;
        }
        if (b1.hp <= 0 || b2.hp <= 0) {
            winner = b1.hp <= 0 ? 2 : 1;
            gameActive = false;
            isVictory = true; // Attiva la celebrazione
            // La pallina sconfitta scompare con un effetto
            const loser = b1.hp <= 0 ? b1 : b2;
            spawnParticles(loser.x, loser.y, loser.color, 40);
            balls = balls.filter(b => b.hp > 0);
            endGame();
        }

        // Update Bars
        document.getElementById('hp1').style.width = `${(balls[0].hp / MAX_HP) * 100}%`;
        document.getElementById('hp2').style.width = `${(balls[1].hp / MAX_HP) * 100}%`;

        // Update Numbers
        document.getElementById('hp-val1').innerText = Math.max(0, Math.floor(balls[0].hp));
        document.getElementById('hp-val2').innerText = Math.max(0, Math.floor(balls[1].hp));
    }

    function loop() {
        if (gameActive || isVictory) {
            if (screenShake > 0) screenShake *= 0.9;
            if (flashOpacity > 0) flashOpacity -= 0.04;
            if (globalTimeScale < 1.0) globalTimeScale = Math.min(1.0, globalTimeScale + SLOW_MO_DECAY);

            balls.forEach(b => b.update());
            if (gameActive) checkCombat();

            if (isVictory) {
                victoryTimer++;
                if (victoryTimer % 25 === 0) spawnFirework();
                if (victoryTimer > 200 && victoryTimer % 60 === 0) {
                    // Mostra il pulsante riprova dopo un po' di festa se vuoi, 
                    // ma per ora lasciamo solo i fuochi come richiesto.
                }
            }

            effects.forEach(e => {
                e.x += e.vx * globalTimeScale;
                e.y += e.vy * globalTimeScale;
                if (e.gravity) e.vy += e.gravity * globalTimeScale;
                e.life -= 0.02;
            });
            effects = effects.filter(e => e.life > 0);
        }
        ctx.save();
        if (screenShake > 0.5) ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        balls.forEach(b => b.draw());
        if (impactLines > 0) {
            ctx.strokeStyle = `rgba(255,255,255,${impactLines})`; ctx.lineWidth = 3;
            for (let i = 0; i < 15; i++) {
                const a = (Math.PI * 2 / 15) * i;
                ctx.beginPath(); ctx.moveTo(canvas.width / 2 + Math.cos(a) * 50, canvas.height / 2 + Math.sin(a) * 50);
                ctx.lineTo(canvas.width / 2 + Math.cos(a) * 2000, canvas.height / 2 + Math.sin(a) * 2000); ctx.stroke();
            }
            impactLines -= 0.04;
        }
        effects.forEach(e => { ctx.globalAlpha = e.life; ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2); ctx.fill(); });
        if (flashOpacity > 0) { ctx.globalAlpha = flashOpacity; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.restore(); requestAnimationFrame(loop);
    }

    function initGame() {
        balls = [new Ball(canvas.width * 0.2, canvas.height * 0.5, BALL1_COLOR, 1), new Ball(canvas.width * 0.8, canvas.height * 0.5, BALL2_COLOR, 2)];
        gameActive = true; isVictory = false; victoryTimer = 0;
        effects = []; winner = null; globalTimeScale = 1.0; impactLines = 0; screenShake = 0; flashOpacity = 0;
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('win-screen').classList.add('hidden');
        initAudio();
    }

    function endGame() {
        // Nessun overlay, nessuna scritta. L'arena rimane pulita con il vincitore.
        console.log("🏆 Fine battaglia. Vincitore nell'arena.");
    }

    function resize() {
        const c = document.getElementById('game-container'); const h = document.getElementById('hp-container');
        canvas.width = c.clientWidth; canvas.height = c.clientHeight - h.offsetHeight;
    }

    window.addEventListener('resize', resize); resize();
    document.getElementById('start-btn').addEventListener('click', initGame);
    document.getElementById('restart-btn').addEventListener('click', initGame);
    loop();
})();
