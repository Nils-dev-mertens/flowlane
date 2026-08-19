import { animate, inView, motionValue, scroll, stagger } from 'motion';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = [0.22, 1, 0.36, 1];

// Hero: pointer-driven parallax and magnetic CTAs.
const hero = document.getElementById('hero');
if (hero && !reduce) {
  const layerDefs = [
    { el: hero.querySelector('.hero-frame-a'), strength: 34 },
    { el: hero.querySelector('.hero-frame-b'), strength: -26 },
    { el: hero.querySelector('[data-parallax]'), strength: 10 },
  ];
  const layers = layerDefs
    .filter((l) => l.el)
    .map((l) => ({ ...l, x: motionValue(0), y: motionValue(0) }));

  layers.forEach((l) => {
    animate(l.el, { x: l.x, y: l.y }, { type: 'spring', stiffness: 90, damping: 18, mass: 0.8 });
  });

  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    layers.forEach((l) => {
      l.x.set(nx * l.strength);
      l.y.set(ny * l.strength);
    });
  });

  hero.addEventListener('pointerleave', () => {
    layers.forEach((l) => {
      l.x.set(0);
      l.y.set(0);
    });
  });

  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const mx = motionValue(0);
    const my = motionValue(0);
    animate(el, { x: mx, y: my }, { type: 'spring', stiffness: 180, damping: 14, mass: 0.5 });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      mx.set((e.clientX - (r.left + r.width / 2)) * 0.18);
      my.set((e.clientY - (r.top + r.height / 2)) * 0.18);
    });
    el.addEventListener('pointerleave', () => {
      mx.set(0);
      my.set(0);
    });
  });
}

if (reduce) {
  // Never hide content for users who asked for reduced motion.
  document.querySelectorAll('[data-reveal], [data-reveal-group] > *').forEach((el) => {
    el.style.opacity = 1;
  });
} else {
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    inView(
      el,
      () => {
        animate(
          el,
          { opacity: [0, 1], y: [28, 0], filter: ['blur(6px)', 'blur(0px)'] },
          {
            duration: 0.7,
            delay: Number(el.dataset.revealDelay || 0),
            ease: easeOut,
          }
        );
      },
      { margin: '-60px 0px -60px 0px' }
    );
  });

  document.querySelectorAll('[data-reveal-group]').forEach((group) => {
    inView(
      group,
      () => {
        animate(Array.from(group.children), { opacity: [0, 1], y: [24, 0] }, {
          duration: 0.6,
          delay: stagger(0.08),
          ease: easeOut,
        });
      },
      { margin: '-60px 0px -60px 0px' }
    );
  });

  // Terminal streaming: type each command line and reveal its output when the
  // terminal scrolls into view. Replays every time it re-enters the viewport.
  document.querySelectorAll('[data-stream]').forEach((root) => {
    const cmds = Array.from(root.querySelectorAll('.term-cmd-line'));
    const typed = cmds.map((c) => c.querySelector('[data-type]'));
    const outs = Array.from(root.querySelectorAll('.term-out'));
    const groups = cmds.map(() => []);

    let lastIdx = -1;
    const ordered = Array.from(root.querySelectorAll('.term-cmd-line, .term-out'));
    for (const el of ordered) {
      if (el.classList.contains('term-cmd-line')) {
        lastIdx = cmds.indexOf(el);
      } else if (lastIdx >= 0) {
        groups[lastIdx].push(el);
      }
    }

    const startState = () => {
      typed.forEach((t) => {
        if (t) t.textContent = '';
      });
      cmds.forEach((c) => c.classList.remove('active'));
      outs.forEach((o) => {
        o.style.opacity = '0';
        o.style.transform = 'translateY(6px)';
      });
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let playing = false;

    const play = async () => {
      if (playing) return;
      playing = true;
      startState();
      for (let i = 0; i < cmds.length; i++) {
        cmds[i].classList.add('active');
        const t = typed[i];
        const text = t ? t.dataset.type || '' : '';
        if (t && text) {
          await new Promise((resolve) => {
            animate(0, text.length, {
              duration: Math.max(0.45, text.length * 0.045),
              ease: 'linear',
              onUpdate: (v) => {
                t.textContent = text.slice(0, Math.round(v));
              },
              onComplete: resolve,
            });
          });
        }
        await sleep(220);
        const group = groups[i] || [];
        await new Promise((resolve) => {
          animate(group, { opacity: [0, 1], y: [6, 0] }, {
            duration: 0.35,
            ease: easeOut,
            onComplete: resolve,
          });
        });
        cmds[i].classList.remove('active');
        if (i === cmds.length - 1) cmds[i].classList.add('active');
      }
      playing = false;
    };

    startState();

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) play();
        });
      },
      { threshold: 0.3 }
    );
    io.observe(root);
  });
}

const progress = document.querySelector('[data-scroll-progress]');
if (progress) {
  scroll(animate(progress, { scaleX: [0, 1] }, { ease: 'linear' }));
}