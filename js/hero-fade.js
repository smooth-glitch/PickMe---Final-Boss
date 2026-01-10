const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function initHeroFade() {
    const hero = document.getElementById("hero");
    if (!hero) return;

    const update = () => {
        const h = hero.offsetHeight || 1;
        const end = h * 0.75; // fully faded by ~75% of hero height
        const y = window.scrollY || document.documentElement.scrollTop || 0;

        const p = clamp(y / end, 0, 1);
        const alpha = 1 - p;

        hero.style.setProperty("--heroAlpha", alpha.toFixed(3));
        hero.style.setProperty("--heroLift", `${-10 * p}px`);
        hero.classList.toggle("is-hero-faded", p > 0.98);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
}

initHeroFade();
