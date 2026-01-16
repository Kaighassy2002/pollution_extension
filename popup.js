// Load and display data when popup opens
document.addEventListener('DOMContentLoaded', () => {
  loadPendingRecords();
  loadScrapedData();
  loadLatestSavedData();
  setupEventListeners();
});

// Load pending records
async function loadPendingRecords() {
  try {
    chrome.runtime.sendMessage(
      { type: 'GET_PENDING' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error loading pending records:', chrome.runtime.lastError);
          return;
        }
        
        const pendingRecords = response.data || [];
        const container = document.getElementById('pendingRecordsContainer');
        
        if (pendingRecords.length === 0) {
          container.innerHTML = '<div class="no-data">No pending records.</div>';
          return;
        }
        
        // Sort by timestamp (newest first)
        pendingRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        container.innerHTML = pendingRecords.map((record, index) => {
          const inputId = `pendingMobile_${index}`;
          const errorId = `pendingError_${index}`;
          
          return `
            <div class="pending-item">
              <div class="pending-item-header">🚗 ${escapeHtml(record.vehicleNo)}</div>
              <div class="data-item">
                <span class="data-label">Valid Date:</span>
                <span class="data-value">${escapeHtml(record.validDate || 'N/A')}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Valid Upto:</span>
                <span class="data-value">${escapeHtml(record.uptoDate || 'N/A')}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Rate:</span>
                <span class="data-value">₹${escapeHtml(record.rate || '0')}</span>
              </div>
              <div class="input-group" style="margin-top: 10px;">
                <input type="tel" id="${inputId}" 
                       class="pending-input" 
                       placeholder="Enter mobile number" 
                       maxlength="10" 
                       pattern="[0-9]{10}"
                       data-vehicle-no="${escapeHtml(record.vehicleNo)}">
                <div id="${errorId}" class="error"></div>
              </div>
              <button class="complete-btn" data-vehicle-no="${escapeHtml(record.vehicleNo)}" data-input-id="${inputId}" data-error-id="${errorId}">
                ✅ Complete & Save
              </button>
            </div>
          `;
        }).join('');
        
        // Setup event listeners for pending records
        setupPendingRecordListeners();
      }
    );
  } catch (error) {
    console.error('Error loading pending records:', error);
    document.getElementById('pendingRecordsContainer').innerHTML = 
      '<div class="no-data">Error loading pending records.</div>';
  }
}

// Setup event listeners for pending records
function setupPendingRecordListeners() {
  const completeButtons = document.querySelectorAll('.complete-btn');
  
  completeButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const vehicleNo = button.getAttribute('data-vehicle-no');
      const inputId = button.getAttribute('data-input-id');
      const errorId = button.getAttribute('data-error-id');
      
      const mobileInput = document.getElementById(inputId);
      const errorDiv = document.getElementById(errorId);
      
      const mobile = mobileInput.value.trim();
      
      // Validate mobile number
      if (!mobile) {
        errorDiv.textContent = 'Please enter a mobile number';
        return;
      }
      
      if (!/^\d{10}$/.test(mobile)) {
        errorDiv.textContent = 'Please enter exactly 10 digits';
        return;
      }
      
      // Disable button
      button.disabled = true;
      button.textContent = 'Saving...';
      errorDiv.textContent = '';
      
      try {
        chrome.runtime.sendMessage(
          { type: 'COMPLETE_PENDING', payload: { vehicleNo, mobile } },
          (response) => {
            if (chrome.runtime.lastError) {
              throw new Error(chrome.runtime.lastError.message);
            }
            
            if (response && response.success) {
              errorDiv.textContent = '';
              errorDiv.innerHTML = '<div class="success">Saved successfully! ✅</div>';
              
              // Reload after delay
              setTimeout(() => {
                loadPendingRecords();
                loadLatestSavedData();
              }, 500);
            } else {
              throw new Error(response?.error || 'Failed to save');
            }
            
            button.disabled = false;
            button.textContent = '✅ Complete & Save';
          }
        );
      } catch (error) {
        console.error('Error completing pending record:', error);
        errorDiv.innerHTML = '<div class="error">Error saving. Please try again.</div>';
        button.disabled = false;
        button.textContent = '✅ Complete & Save';
      }
    });
  });
  
  // Allow Enter key to complete
  const pendingInputs = document.querySelectorAll('.pending-input');
  pendingInputs.forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const vehicleNo = input.getAttribute('data-vehicle-no');
        const button = document.querySelector(`.complete-btn[data-vehicle-no="${vehicleNo}"]`);
        if (button) button.click();
      }
    });
  });
}

// Load scraped data from storage
async function loadScrapedData() {
  try {
    const result = await chrome.storage.local.get(['latestScrapedData']);
    const scrapedData = result.latestScrapedData;
    
    const container = document.getElementById('scrapedDataContainer');
    
    if (scrapedData && scrapedData.vehicleNo) {
      container.innerHTML = `
        <div class="data-item">
          <span class="data-label">Vehicle Number:</span>
          <span class="data-value">${escapeHtml(scrapedData.vehicleNo)}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Valid Date:</span>
          <span class="data-value">${escapeHtml(scrapedData.validDate || 'N/A')}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Valid Upto Date:</span>
          <span class="data-value">${escapeHtml(scrapedData.uptoDate || 'N/A')}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Rate:</span>
          <span class="data-value">₹${escapeHtml(scrapedData.rate || '0')}</span>
        </div>
      `;
    } else {
      container.innerHTML = '<div class="no-data">No data scraped yet. Please visit the certificate page.</div>';
    }
  } catch (error) {
    console.error('Error loading scraped data:', error);
    document.getElementById('scrapedDataContainer').innerHTML = 
      '<div class="no-data">Error loading data.</div>';
  }
}

// Load latest saved data from storage
async function loadLatestSavedData() {
  try {
    const result = await chrome.storage.local.get(['latestSavedData']);
    const savedData = result.latestSavedData;
    
    const container = document.getElementById('savedDataContainer');
    
    if (savedData && savedData.vehicleNo) {
      // Format dates for display
      const validDate = savedData.validDate ? formatDateForDisplay(savedData.validDate) : 'N/A';
      const uptoDate = savedData.uptoDate ? formatDateForDisplay(savedData.uptoDate) : 'N/A';
      
      container.innerHTML = `
        <div class="data-item">
          <span class="data-label">Vehicle Number:</span>
          <span class="data-value">${escapeHtml(savedData.vehicleNo)}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Mobile Number:</span>
          <span class="data-value">${escapeHtml(savedData.mobile || 'N/A')}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Valid Date:</span>
          <span class="data-value">${validDate}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Valid Upto Date:</span>
          <span class="data-value">${uptoDate}</span>
        </div>
        <div class="data-item">
          <span class="data-label">Rate:</span>
          <span class="data-value">₹${escapeHtml(savedData.rate || '0')}</span>
        </div>
      `;
    } else {
      container.innerHTML = '<div class="no-data">No data saved yet.</div>';
    }
  } catch (error) {
    console.error('Error loading saved data:', error);
    document.getElementById('savedDataContainer').innerHTML = 
      '<div class="no-data">Error loading data.</div>';
  }
}

// Setup event listeners
function setupEventListeners() {
  const mobileInput = document.getElementById('mobileInput');
  const saveBtn = document.getElementById('saveBtn');
  const savePendingBtn = document.getElementById('savePendingBtn');
  const mobileError = document.getElementById('mobileError');
  
  // Validate mobile number input (optional field)
  mobileInput.addEventListener('input', () => {
    const value = mobileInput.value.trim();
    mobileError.textContent = '';
    
    if (value && !/^\d{10}$/.test(value)) {
      mobileError.textContent = 'Please enter exactly 10 digits (or leave blank)';
    }
  });
  
  // Handle save button click (with or without mobile - both are allowed)
  saveBtn.addEventListener('click', async () => {
    await saveData();
  });
  
  // Handle save pending button click (without mobile)
  savePendingBtn.addEventListener('click', async () => {
    await saveAsPending();
  });
  
  // Allow Enter key to save
  mobileInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      await saveData();
    }
  });
}

// Save data with or without mobile number (mobile is optional)
async function saveData() {
  const mobileInput = document.getElementById('mobileInput');
  const mobileError = document.getElementById('mobileError');
  const saveMessage = document.getElementById('saveMessage');
  const saveBtn = document.getElementById('saveBtn');
  
  const mobile = mobileInput.value.trim();
  
  // Validate mobile number format if provided (mobile is optional)
  if (mobile && !/^\d{10}$/.test(mobile)) {
    mobileError.textContent = 'Please enter exactly 10 digits (or leave blank)';
    return;
  }
  
  // Get scraped data
  const result = await chrome.storage.local.get(['latestScrapedData']);
  const scrapedData = result.latestScrapedData;
  
  if (!scrapedData || !scrapedData.vehicleNo) {
    saveMessage.innerHTML = '<div class="error">No scraped data found. Please scrape data first.</div>';
    return;
  }
  
  // Prepare data with mobile number
  const dataToSave = {
    ...scrapedData,
    mobile: mobile
  };
  
  // Disable button and show loading
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  saveMessage.innerHTML = '';
  mobileError.textContent = '';
  
  try {
    // Send message to background script to save data
    chrome.runtime.sendMessage(
      { type: 'SAVE_DATA', payload: dataToSave },
      async (response) => {
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }
        
        if (response && response.success) {
          saveMessage.innerHTML = '<div class="success">Data saved successfully! ✅</div>';
          mobileInput.value = '';
          
          // Reload data after a short delay
          setTimeout(() => {
            loadLatestSavedData();
            loadPendingRecords();
          }, 500);
        } else {
          throw new Error('Failed to save data');
        }
        
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Data';
      }
    );
  } catch (error) {
    console.error('Error saving data:', error);
    saveMessage.innerHTML = '<div class="error">Error saving data. Please try again.</div>';
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Data';
  }
}

// Save as pending (without mobile number)
async function saveAsPending() {
  const savePendingBtn = document.getElementById('savePendingBtn');
  const saveMessage = document.getElementById('saveMessage');
  
  // Get scraped data
  const result = await chrome.storage.local.get(['latestScrapedData']);
  const scrapedData = result.latestScrapedData;
  
  if (!scrapedData || !scrapedData.vehicleNo) {
    saveMessage.innerHTML = '<div class="error">No scraped data found. Please scrape data first.</div>';
    return;
  }
  
  // Disable button
  savePendingBtn.disabled = true;
  savePendingBtn.textContent = 'Saving...';
  saveMessage.innerHTML = '';
  
  try {
    chrome.runtime.sendMessage(
      { type: 'SAVE_PENDING', payload: scrapedData },
      (response) => {
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }
        
        if (response && response.success) {
          saveMessage.innerHTML = '<div class="success">Saved as pending! 📌</div>';
          
          // Reload pending records
          setTimeout(() => {
            loadPendingRecords();
          }, 300);
        } else {
          throw new Error('Failed to save as pending');
        }
        
        savePendingBtn.disabled = false;
        savePendingBtn.textContent = '📌 Save as Pending (Without Mobile)';
      }
    );
  } catch (error) {
    console.error('Error saving as pending:', error);
    saveMessage.innerHTML = '<div class="error">Error saving as pending. Please try again.</div>';
    savePendingBtn.disabled = false;
    savePendingBtn.textContent = '📌 Save as Pending (Without Mobile)';
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper function to format date for display
function formatDateForDisplay(dateStr) {
  if (!dateStr) return 'N/A';
  
  // If it's already a formatted string (DD/MM/YYYY), return as is
  if (typeof dateStr === 'string' && dateStr.includes('/')) {
    return dateStr;
  }
  
  // If it's a Date object or ISO string, format it
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateStr;
  }
}
