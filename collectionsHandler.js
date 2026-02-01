const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// تحديد مسار الملف في الـ AppData عشان يفضل موجود حتى لو نقلت البرنامج
const dataPath = path.join(app.getPath('userData'), 'BaddelLauncher');
const collectionsFile = path.join(dataPath, 'collections.json');
const FAV_ID = 'fav_system_default';

// التأكد من وجود المجلد والملف
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
if (!fs.existsSync(collectionsFile)) fs.writeFileSync(collectionsFile, JSON.stringify([]));

// 1. قراءة البيانات
function getCollections() {
    try {
        let data = [];
        if (fs.existsSync(collectionsFile)) {
            data = JSON.parse(fs.readFileSync(collectionsFile));
        }

        // 🔥 التعديل: التأكد إن كولكشن المفضلة موجودة
        const favExists = data.find(c => c.id === FAV_ID);
        if (!favExists) {
            const favColl = {
                id: FAV_ID,
                name: "Favorites",
                image: null, // ممكن تحط مسار صورة افتراضية هنا لو عايز
                gameIds: [],
                isSystem: true // علامة عشان الفرونت إند يعرف إن دي مميزة
            };
            // بنحطها في الأول
            data.unshift(favColl);
            saveCollections(data);
        }

        return data;
    } catch (e) {
        console.error("Error reading collections:", e);
        return [];
    }
}

// 2. حفظ البيانات (أهم دالة)
function saveCollections(data) {
    try {
        fs.writeFileSync(collectionsFile, JSON.stringify(data, null, 2));
        console.log("✅ Collections Saved to Disk!");
    } catch (e) {
        console.error("❌ Failed to save collections:", e);
    }
}

// 3. إنشاء كولكشن
function createCollection(name, imagePath) {
    const collections = getCollections();
    const newColl = {
        id: "col_" + Date.now(), // ID ثابت
        name: name,
        image: imagePath || null,
        gameIds: [] 
    };
    collections.push(newColl);
    saveCollections(collections); // 🔥 حفظ فوري
    return { status: 'success', collection: newColl };
}

// 4. إضافة لعبة (هنا كانت المشكلة غالباً)
function addGameToCollection(collectionId, gameId) {
    console.log(`Adding Game ${gameId} to Collection ${collectionId}`);
    const collections = getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    
    if (index > -1) {
        // لو اللعبة مش موجودة، ضيفها
        if (!collections[index].gameIds.includes(gameId)) {
            collections[index].gameIds.push(gameId);
            saveCollections(collections); // 🔥 حفظ فوري ومهم جداً
            return { status: 'success' };
        } else {
            return { status: 'exists', message: 'Game already in collection' };
        }
    }
    return { status: 'error', message: 'Collection not found' };
}

// 5. حذف كولكشن
function deleteCollection(collectionId) {
    let collections = getCollections();
    const initialLength = collections.length;
    collections = collections.filter(c => c.id !== collectionId);
    
    if (collections.length !== initialLength) {
        saveCollections(collections); // 🔥 حفظ فوري
        return { status: 'success' };
    }
    return { status: 'error' };
}


function removeGameFromCollection(collectionId, gameId) {
    const collections = getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    
    if (index > -1) {
        // فلترة مصفوفة الألعاب عشان نشيل منها الـ ID ده
        const initialLength = collections[index].gameIds.length;
        collections[index].gameIds = collections[index].gameIds.filter(id => id !== gameId);
        
        // لو حصل تغيير فعلاً، نحفظ
        if (collections[index].gameIds.length !== initialLength) {
            saveCollections(collections);
            return { status: 'success' };
        }
        return { status: 'error', message: 'Game not found in this collection' };
    }
    return { status: 'error', message: 'Collection not found' };
}

// 6. دالة إعادة ترتيب الكولكشن (الجديدة)
function reorderCollection(collectionId, newGameIds) {
    const collections = getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    
    if (index > -1) {
        // تحديث قائمة الألعاب بالترتيب الجديد اللي جاي من الفرونت إند
        collections[index].gameIds = newGameIds;
        saveCollections(collections); // حفظ فوري
        return { status: 'success' };
    }
    return { status: 'error', message: 'Collection not found' };
}

// 7. تحديث بيانات الكولكشن (اسم أو صورة)
function updateCollectionDetails(collectionId, newName, newImage) {
    const collections = getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    
    if (index > -1) {
        // لو مبعوت اسم جديد، حدثه
        if (newName) collections[index].name = newName;
        // لو مبعوت صورة جديدة، حدثها
        if (newImage) collections[index].image = newImage;
        
        saveCollections(collections);
        return { status: 'success' };
    }
    return { status: 'error', message: 'Collection not found' };
}

module.exports = {
    getCollections,
    createCollection,
    addGameToCollection,
    deleteCollection,
    removeGameFromCollection,
    reorderCollection,
    updateCollectionDetails,
};