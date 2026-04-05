// ============================================================
// BADDEL LAUNCHER - GUIDED TOUR (Driver.js)
// ============================================================

function startTour() {
    if (typeof window.driver === 'undefined') {
        console.error('[Tour] Driver.js not loaded — check CDN link in dashboard.html.');
        return;
    }

    const driverFn = (window.driver.js && window.driver.js.driver) || window.driver;
    if (typeof driverFn !== 'function') {
        console.error('[Tour] Driver function missing.');
        return;
    }

    try {
        const tour = driverFn({
            showProgress: true,
            allowClose: false,
            nextBtnText: 'Next',
            prevBtnText: 'Previous',
            doneBtnText: "Let's Play!",
            steps: [
                {
                    element: '#btn-add-game',
                    popover: { title: 'Build Your Library', description: 'Have a standalone game? Click here to add it.', side: 'bottom', align: 'start' }
                },
                {
                    element: '#btn-scan',
                    popover: { title: 'Auto-Scan & Recycle Bin', description: 'Left-click to sync games. Right-click for Recycle Bin.', side: 'bottom' }
                },
                {
                    element: '#surpriseMeSection',
                    popover: { title: "Can't Decide?", description: 'Let the Baddel Roulette pick your next adventure.', side: 'top', align: 'center' }
                },
                {
                    element: '#systemStatsSection',
                    popover: { title: 'Live Telemetry', description: 'Monitor your PC performance in real-time.', side: 'top', align: 'center' }
                },
                {
                    element: '#gamesGrid',
                    popover: { title: 'Customize Everything', description: 'Right-click any game to change artwork. Drag & Drop to reorder!', side: 'top', align: 'center' }
                },
                {
                    element: '.help-btn',
                    popover: { title: 'We are Listening', description: 'Found a bug or have a cool idea? Send direct feedback.', side: 'bottom', align: 'center' }
                }
            ],
            onDestroyStarted: () => {
                if (!tour.hasNextStep() || confirm('Do you want to skip the tour?')) {
                    tour.destroy();
                    localStorage.setItem('baddel_tour_seen', 'true');
                }
            }
        });

        tour.drive();
    } catch (err) {
        console.error('[Tour] Crashed:', err);
    }
}

window.checkAndStartTour = function () {
    const seen     = localStorage.getItem('baddel_tour_seen');
    const modalOpen = document.querySelector('.modal-overlay.active');
    if (!seen && !modalOpen) startTour();
};

// --- Dev shortcut: F4 forces the tour to restart ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'F4') {
        localStorage.removeItem('baddel_tour_seen');
        startTour();
    }
});
