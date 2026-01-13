async function refresh() {
  const { formCapture_status, formCapture_queue } = await chrome.storage.local.get(["formCapture_status", "formCapture_queue"]);
  
  const s = formCapture_status || {};
  const q = Array.isArray(formCapture_queue) ? formCapture_queue : [];

  document.getElementById("totalSynced").textContent = String(s.totalSynced || 0);
  document.getElementById("queueSize").textContent = String(q.length);
}

document.getElementById("refreshBtn").addEventListener("click", refresh);

// Run when popup opens
refresh();
