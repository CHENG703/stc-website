(function() {
    'use strict';

    var scrollObserver = null;

    function getScrollObserver() {
        if (scrollObserver) return scrollObserver;
        if (!('IntersectionObserver' in window)) return null;
        scrollObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    scrollObserver.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.05,
            rootMargin: '0px 0px -20px 0px'
        });
        return scrollObserver;
    }

    function initScrollReveal() {
        var selectors = '.task-card, .message-item, .about-card, .feature-card, .team-card, .stat-card, .section-title, .glass-card, .admin-stat-card, .user-info, .user-avatar-section, .action-card, .task-filter-tabs, .task-card-container';
        var elements = document.querySelectorAll(selectors);

        elements.forEach(function(el, index) {
            if (el.classList.contains('reveal')) return;
            el.classList.add('reveal');
            var delay = index % 4;
            if (delay > 0) {
                el.classList.add('reveal-delay-' + delay);
            }
        });

        var observer = getScrollObserver();
        if (observer) {
            document.querySelectorAll('.reveal:not(.visible)').forEach(function(el) {
                observer.observe(el);
            });
        } else {
            document.querySelectorAll('.reveal').forEach(function(el) {
                el.classList.add('visible');
            });
        }
    }

    function initButtonRipple() {
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.btn');
            if (!btn) return;

            var rect = btn.getBoundingClientRect();
            var size = Math.max(rect.width, rect.height);
            var x = e.clientX - rect.left - size / 2;
            var y = e.clientY - rect.top - size / 2;

            var ripple = document.createElement('span');
            ripple.className = 'btn-ripple';
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';

            btn.appendChild(ripple);
            setTimeout(function() { ripple.remove(); }, 600);
        });
    }

    function initNavbarScroll() {
        var navbar = document.querySelector('.navbar');
        if (!navbar) return;

        var ticking = false;
        window.addEventListener('scroll', function() {
            if (!ticking) {
                requestAnimationFrame(function() {
                    if (window.scrollY > 20) {
                        navbar.classList.add('scrolled');
                    } else {
                        navbar.classList.remove('scrolled');
                    }
                    ticking = false;
                });
                ticking = true;
            }
        });
    }

    window.reinitScrollAnimations = function() {
        setTimeout(initScrollReveal, 80);
    };

    function init() {
        initButtonRipple();
        initNavbarScroll();
        
        setTimeout(function() {
            initScrollReveal();
        }, 200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
