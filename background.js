// Store scraped data and handle saving to backend
let totalSynced = 0;

// Listen for scraped data from page 2
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCRAPED_DATA") {
    const scrapedData = message.payload;
    console.log("📩 Scraped data received:", scrapedData);
    
    // Store scraped data in chrome.storage for popup to display
    chrome.storage.local.set({
      latestScrapedData: scrapedData
    });
    
    // Automatically save as pending if it doesn't already exist
    // NOTE: Pending records are stored LOCALLY ONLY - NOT sent to backend
    // Backend requires mobile number, so records stay in local storage until mobile is added
    chrome.storage.local.get(["pendingRecords"], (result) => {
      const pendingRecords = result.pendingRecords || [];
      
      // Check if this vehicle number already exists in pending
      const exists = pendingRecords.find(r => r.vehicleNo === scrapedData.vehicleNo);
      
      if (!exists) {
        // Add timestamp for sorting
        const pendingRecord = {
          ...scrapedData,
          timestamp: Date.now()
        };
        pendingRecords.push(pendingRecord);
        
        // Store locally only - NOT sent to backend (backend requires mobile number)
        chrome.storage.local.set({ pendingRecords });
        console.log("📌 Saved as pending (local storage only):", pendingRecord);
      }
    });
    
    // Show notification that data was scraped
    showNotification(
      "Data Scraped Successfully ✅",
      `Pollution details for ${scrapedData.vehicleNo} are ready.`
    );
    
    sendResponse({ success: true });
    return true;
  }
  
  // Handle save request from popup (with mobile number - direct save)
  if (message.type === "SAVE_DATA") {
    const dataWithMobile = message.payload;
    console.log("💾 Saving data with mobile:", dataWithMobile);
    
    const formattedRecord = formatRecordForBackend(dataWithMobile);
    sendToBackend(formattedRecord, () => {
      // Remove from pending if it exists
      removeFromPending(dataWithMobile.vehicleNo);
    });
    
    sendResponse({ success: true });
    return true; // Keep connection open for async response
  }
  
  // Handle save pending (without mobile number)
  // NOTE: Pending records are stored LOCALLY ONLY (chrome.storage.local)
  // They are NOT sent to backend until mobile number is added via COMPLETE_PENDING
  if (message.type === "SAVE_PENDING") {
    const dataWithoutMobile = message.payload;
    console.log("📌 Saving as pending (local storage only):", dataWithoutMobile);
    
    chrome.storage.local.get(["pendingRecords"], (result) => {
      const pendingRecords = result.pendingRecords || [];
      
      // Check if already exists
      const existingIndex = pendingRecords.findIndex(r => r.vehicleNo === dataWithoutMobile.vehicleNo);
      
      const pendingRecord = {
        ...dataWithoutMobile,
        timestamp: Date.now()
      };
      
      if (existingIndex >= 0) {
        pendingRecords[existingIndex] = pendingRecord;
      } else {
        pendingRecords.push(pendingRecord);
      }
      
      // Store locally - NOT sent to backend (backend requires mobile number)
      chrome.storage.local.set({ pendingRecords });
      sendResponse({ success: true });
    });
    
    return true;
  }
  
  // Handle complete pending record (add mobile and save)
  if (message.type === "COMPLETE_PENDING") {
    const { vehicleNo, mobile } = message.payload;
    console.log("✅ Completing pending record:", vehicleNo, mobile);
    
    chrome.storage.local.get(["pendingRecords"], (result) => {
      const pendingRecords = result.pendingRecords || [];
      const pendingRecord = pendingRecords.find(r => r.vehicleNo === vehicleNo);
      
      if (pendingRecord) {
        const completeRecord = {
          ...pendingRecord,
          mobile: mobile
        };
        
        const formattedRecord = formatRecordForBackend(completeRecord);
        sendToBackend(formattedRecord, () => {
          // Remove from pending
          removeFromPending(vehicleNo);
        });
        
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "Pending record not found" });
      }
    });
    
    return true;
  }
  
  // Handle request for latest saved data
  if (message.type === "GET_LATEST_SAVED") {
    chrome.storage.local.get(["latestSavedData"], (result) => {
      sendResponse({ data: result.latestSavedData || null });
    });
    return true;
  }
  
  // Handle get pending records
  if (message.type === "GET_PENDING") {
    chrome.storage.local.get(["pendingRecords"], (result) => {
      sendResponse({ data: result.pendingRecords || [] });
    });
    return true;
  }
});

// Remove record from pending
function removeFromPending(vehicleNo) {
  chrome.storage.local.get(["pendingRecords"], (result) => {
    const pendingRecords = result.pendingRecords || [];
    const updated = pendingRecords.filter(r => r.vehicleNo !== vehicleNo);
    chrome.storage.local.set({ pendingRecords: updated });
    console.log("🗑️ Removed from pending:", vehicleNo);
  });
}

// Format record for backend
function formatRecordForBackend(record) {
  const parseDate = (str) => {
    if (!str) return null;
    const [day, month, year] = str.split("/");
    return new Date(`${year}-${month}-${day}`);
  };

  let cleanedRate = record.rate || "0";
  cleanedRate = Math.floor(Number(cleanedRate));

  const formatted = {
    vehicleNo: record.vehicleNo,
    mobile: record.mobile || null,
    uptoDate: parseDate(record.uptoDate),
    validDate: parseDate(record.validDate),
    rate: cleanedRate,
    verified: false,
  };

  console.log("🔄 Formatted for backend:", formatted);
  return formatted;
}

// Show Chrome notification
function showNotification(title, message) {
  chrome.notifications.create(
    {
      type: "basic",
      iconUrl: "icon128.png",
      title,
      message,
      priority: 2,
    },
    (notificationId) => {
      // Auto-close after 5 seconds
      setTimeout(() => {
        chrome.notifications.clear(notificationId);
      }, 5000);
    }
  );
}

// Send record to backend
// IMPORTANT: Only sends records WITH mobile numbers (backend requires mobile to be mandatory)
function sendToBackend(record, callback) {
  // Validate that mobile number exists (backend requirement)
  if (!record.mobile || record.mobile.trim() === '') {
    console.error("❌ Cannot save to backend: Mobile number is mandatory");
    showNotification(
      "Save Failed ❌",
      "Mobile number is required to save data to the database."
    );
    return;
  }

  console.log("🚀 Sending to backend:", record);

  fetch("https://pollution-server.onrender.com/dataEntry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("✅ Saved to DB:", data);
      totalSynced++;

      // Store latest saved data for popup to display
      chrome.storage.local.set({
        latestSavedData: record,
        formCapture_status: { totalSynced }
      });

      if (callback) callback();

      showNotification(
        "Data Saved Successfully ✅",
        `Vehicle ${record.vehicleNo} pollution details saved.`
      );
    })
    .catch((err) => {
      console.error("❌ Save error:", err);
      showNotification(
        "Save Failed ❌",
        `Could not save data for ${record.vehicleNo}. Please try again.`
      );
    });
}
