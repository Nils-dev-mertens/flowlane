import { animate, inView, scroll, stagger } from 'motion';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = [0.22, 1, 0.36, 1];

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

  // Typewriter effect for `data-type="text to type"` elements.
  document.querySelectorAll('[data-type]').forEach((el) => {
    const text = el.dataset.type || '';
    inView(
      el,
      () => {
        el.textContent = '';
        animate(0, text.length, {
          duration: 1.6,
          ease: 'linear',
          onUpdate: (v) => {
            el.textContent = text.slice(0, Math.round(v));
          },
        });
      },
      { margin: '-40px 0px -40px 0px' }
    );
  });
}

const progress = document.querySelector('[data-scroll-progress]');
if (progress) {
  scroll(animate(progress, { scaleX: [0, 1] }, { ease: 'linear' }));
}