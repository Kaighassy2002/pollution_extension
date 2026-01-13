// In-memory cache (for merging data)
let cache = {};
let totalSynced = 0;
let queue = [];

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "COLLECT_DATA") {
    const newData = message.payload;
    const vehicleNo = newData.vehicleNo;
    if (!vehicleNo) return;

    console.log("📩 Incoming data:", newData);

    // Merge new data with existing cache
    cache[vehicleNo] = cache[vehicleNo]
      ? { ...cache[vehicleNo], ...newData }
      : { ...newData };

    const record = cache[vehicleNo];
    console.log("📝 Current merged record:", record);

    // ✅ Check if record is fully complete
    if (record.mobile && record.rate && record.validDate && record.uptoDate) {
      const formattedRecord = formatRecordForBackend(record);
      console.log("✅ Record complete, sending to backend:", formattedRecord);

      sendToBackend(formattedRecord);
      delete cache[vehicleNo];

      // Remove from queue if exists
      queue = queue.filter((r) => r.vehicleNo !== vehicleNo);
    } else {
      // Add to queue if not complete
      if (!queue.find((r) => r.vehicleNo === vehicleNo)) {
        queue.push(record);
        console.log("⏳ Added to queue (incomplete):", record);
      } else {
        // If already exists, update the queue record too
        queue = queue.map((r) =>
          r.vehicleNo === vehicleNo ? record : r
        );
      }
    }

    updateStorage();
  }
});


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
function sendToBackend(record) {
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

      // Remove from queue if present
      queue = queue.filter((r) => r.vehicleNo !== record.vehicleNo);
      updateStorage();

      showNotification(
        "Data Saved Successfully ✅",
        `Vehicle ${record.vehicleNo} pollution details saved.`
      );
    })
    .catch((err) => {
      console.error("❌ Save error:", err);

      // Retry later
      if (!queue.find((r) => r.vehicleNo === record.vehicleNo)) {
        queue.push(record);
        console.log("🔁 Re-added to queue for retry:", record);
      }
      updateStorage();

      showNotification(
        "Save Failed ❌",
        `Could not save data for ${record.vehicleNo}. Will retry later.`
      );
    });
}


// Update Chrome local storage
function updateStorage() {
  console.log("📊 Updating storage → totalSynced:", totalSynced, " | queue:", queue);
  chrome.storage.local.set({
    formCapture_status: { totalSynced },
    formCapture_queue: queue,
  });
}


// ✅ Dynamic Retry (no fixed interval)
function processQueue() {
  if (queue.length === 0) {
    console.log("⏳ No items in queue. Will check again later...");
    // Wait 15 minutes if no data
    setTimeout(processQueue, 15 * 60 * 1000);
    return;
  }

  console.log("🔁 Retrying queue:", queue);

  const retryQueue = [...queue];
  queue = [];

  retryQueue.forEach((record) => {
    const formattedRecord = formatRecordForBackend(record);
    sendToBackend(formattedRecord);
  });

  // Schedule next retry after 10 minutes
  setTimeout(processQueue, 10 * 60 * 1000);
}

// Start dynamic retry loop
processQueue();
