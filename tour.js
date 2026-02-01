// tour.js

function startTour() {
    const driver = window.driver.js.driver;

    const driverObj = driver({
        showProgress: true,
        allowClose: false,
        nextBtnText: 'Next',
        prevBtnText: 'Previous',
        doneBtnText: 'Got it!',
        steps: [
            // 1. Add Game Button
            { 
                element: '#btn-add-game', 
                popover: { 
                    title: 'Add Game Manually', 
                    description: 'Have a standalone EXE file? Click here to add it, and Baddel will automatically fetch its artwork and metadata.', 
                    side: "bottom", 
                    align: 'start' 
                } 
            },
            // 2. Scan Button (Left Click)
            { 
                element: '#btn-scan', 
                popover: { 
                    title: 'Library Scan', 
                    description: 'Left-click here to perform a full scan and instantly detect installed games from Steam, Epic, Riot, and Ubisoft.', 
                    side: "bottom" 
                } 
            },
            // 3. Recycle Bin (Right Click - Hidden Feature)
            { 
                element: '#btn-scan', // Same button, different action explanation
                popover: { 
                    title: 'Recycle Bin', 
                    description: 'Pro Tip: "Right-click" on this button to open the Recycle Bin and restore any games you deleted by mistake.', 
                    side: "bottom", 
                    align: 'center'
                } 
            },
            // 4. Sidebar Collections
            { 
                element: '#collectionsList', 
                popover: { 
                    title: 'Your Collections', 
                    description: 'Here you will find all your custom collections (Favorites, Horror, Online, etc.).', 
                    side: "right" 
                } 
            },
            // 5. New Collection Button
            { 
                element: '#btn-new-coll', 
                popover: { 
                    title: 'Organize Your Library', 
                    description: 'Click here to create a new collection with a custom name and banner.', 
                    side: "top" 
                } 
            },
            // 6. Games Grid (Context Menu)
            { 
                element: '#gamesGrid', 
                popover: { 
                    title: 'Game Controls', 
                    description: 'Right-click on any game card to open the menu: Change artwork, add to favorites, or rename the game.', 
                    side: "top", 
                    align: 'center'
                } 
            }
        ],
        onDestroyStarted: () => {
            if (!driverObj.hasNextStep() || confirm("Do you want to skip the tour?")) {
                driverObj.destroy();
                localStorage.setItem('baddel_tour_seen', 'true');
            }
        },
    });

    driverObj.drive();
}

window.checkAndStartTour = function() {
    const hasSeenTour = localStorage.getItem('baddel_tour_seen');
    
    // لو مشافهوش قبل كده + مفيش أي مودال مفتوح (عشان ميعلقش)
    if (!hasSeenTour && !document.querySelector('.modal-overlay.active')) {
        startTour();
    }
};